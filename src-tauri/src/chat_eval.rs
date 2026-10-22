//! Prototype check for an AI chat over the user's notes (not part of the app yet).
//! Runs a JSONL file of prompts through the language model and writes the replies
//! with timings, so retrieval and prompts can be tried from a script:
//! `FORGOR_MODELS=<dir with language/> FORGOR_PROMPTS=<in.jsonl> FORGOR_REPLIES=<out.jsonl>
//!  cargo test --release --lib chat_eval -- --ignored --nocapture`
//! Each input line: {"id": "...", "system": "...", "user": "...", "max_output": 400}.

use crate::models::{self, llm};
use std::io::{BufRead, Write};
use std::time::Instant;

#[test]
#[ignore]
fn chat_eval() {
    let dir = std::path::PathBuf::from(std::env::var("FORGOR_MODELS").expect("FORGOR_MODELS"));
    let path = dir.join(models::LANGUAGE).join(models::find(models::LANGUAGE).unwrap().files[0].name);
    let input = std::fs::File::open(std::env::var("FORGOR_PROMPTS").expect("FORGOR_PROMPTS")).unwrap();
    let mut out = std::fs::File::create(std::env::var("FORGOR_REPLIES").expect("FORGOR_REPLIES")).unwrap();
    let t = Instant::now();
    let model = llm::shared(&path).unwrap();
    println!("model loaded in {:.1}s", t.elapsed().as_secs_f32());
    for line in std::io::BufReader::new(input).lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }
        let p: serde_json::Value = serde_json::from_str(&line).unwrap();
        // "turns" (a conversation, like the chat plugin sends) goes through the real prompt builder; "user" is a single question.
        let prompt = if p["turns"].is_array() {
            let req: crate::chat::ChatRequest = serde_json::from_value(serde_json::json!({ "id": 0, "system": p["system"], "turns": p["turns"] })).unwrap();
            crate::chat::prompt(&req)
        } else {
            llm::chat(p["system"].as_str().unwrap_or(""), p["user"].as_str().unwrap_or(""))
        };
        let prompt_tokens = llm::count_tokens(&model, &prompt).unwrap();
        let g = llm::Generation { max_output: p["max_output"].as_u64().unwrap_or(500) as usize, temperature: 0.2, seed: 1 };
        let t = Instant::now();
        let mut first = None;
        let mut pieces = 0usize;
        let text = llm::generate(&model, &prompt, &g, &mut |_| {
            first.get_or_insert(t.elapsed());
            pieces += 1;
            true
        })
        .unwrap();
        let total = t.elapsed().as_secs_f32();
        let first = first.unwrap_or_default().as_secs_f32();
        println!("{:<24} prompt {prompt_tokens:>5} tok · first token {first:.1}s · {pieces} tok out · total {total:.1}s", p["id"].as_str().unwrap_or("?"));
        let reply = serde_json::json!({ "id": p["id"], "text": text, "prompt_tokens": prompt_tokens, "first_token_s": first, "output_tokens": pieces, "total_s": total });
        writeln!(out, "{reply}").unwrap();
    }
    llm::unload();
}

/// Where the time goes for one prompt: context setup, reading the prompt, writing the answer.
/// `FORGOR_PROMPTS` as above (first line is used); tries a few context settings.
#[test]
#[ignore]
fn chat_speed() {
    use llama_cpp_2::{context::params::LlamaContextParams, llama_batch::LlamaBatch, model::AddBos, sampling::LlamaSampler};
    use std::num::NonZeroU32;
    let dir = std::path::PathBuf::from(std::env::var("FORGOR_MODELS").expect("FORGOR_MODELS"));
    let path = dir.join(models::LANGUAGE).join(models::find(models::LANGUAGE).unwrap().files[0].name);
    let line = std::fs::read_to_string(std::env::var("FORGOR_PROMPTS").unwrap()).unwrap().lines().next().unwrap().to_string();
    let p: serde_json::Value = serde_json::from_str(&line).unwrap();
    let prompt = llm::chat(p["system"].as_str().unwrap(), p["user"].as_str().unwrap());
    let model = llm::shared(&path).unwrap();
    let tokens = model.str_to_token(&prompt, AddBos::Always).unwrap();
    for (name, ubatch, flash) in [("default", 0u32, None), ("ubatch 1024", 1024, None), ("flash on", 0, Some(1)), ("flash on + ubatch 1024", 1024, Some(1)), ("default again", 0, None)] {
        let t = Instant::now();
        let mut params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(tokens.len() as u32 + 200)).with_n_batch(2048).with_n_threads(models::threads()).with_n_threads_batch(models::threads());
        if ubatch > 0 {
            params = params.with_n_ubatch(ubatch);
        }
        if let Some(f) = flash {
            params = params.with_flash_attention_policy(f);
        }
        let mut ctx = model.new_context(llm::backend().unwrap(), params).unwrap();
        let setup = t.elapsed().as_secs_f32();
        let mut batch = LlamaBatch::new(2048, 1);
        let mut pos = 0i32;
        for chunk in tokens.chunks(2048) {
            batch.clear();
            for (i, tok) in chunk.iter().enumerate() {
                batch.add(*tok, pos + i as i32, &[0], pos as usize + i == tokens.len() - 1).unwrap();
            }
            ctx.decode(&mut batch).unwrap();
            pos += chunk.len() as i32;
        }
        let read = t.elapsed().as_secs_f32() - setup;
        let mut sampler = LlamaSampler::chain_simple([LlamaSampler::temp(0.2), LlamaSampler::dist(1)]);
        let t2 = Instant::now();
        for _ in 0..50 {
            let tok = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(tok);
            batch.clear();
            batch.add(tok, pos, &[0], true).unwrap();
            pos += 1;
            ctx.decode(&mut batch).unwrap();
        }
        let gen = t2.elapsed().as_secs_f32();
        println!("{name:<24} setup {setup:.2}s · read {} tok in {read:.2}s ({:.0} tok/s) · write 50 tok in {gen:.2}s ({:.0} tok/s)", tokens.len(), tokens.len() as f32 / read, 50.0 / gen);
    }
    llm::unload();
}

/// Embeddings for search by meaning: `FORGOR_EMBED_MODEL=<gguf> FORGOR_EMBED_IN=<jsonl {id,text}>
/// FORGOR_EMBED_OUT=<jsonl {id,vec}>`. One text at a time, mean-pooled and normalised.
#[test]
#[ignore]
fn chat_embed() {
    use llama_cpp_2::model::{params::LlamaModelParams, LlamaModel};
    let backend = llm::backend().unwrap();
    let t = Instant::now();
    let model = LlamaModel::load_from_file(backend, std::env::var("FORGOR_EMBED_MODEL").unwrap(), &LlamaModelParams::default().with_n_gpu_layers(999)).unwrap();
    println!("embedding model loaded in {:.2}s", t.elapsed().as_secs_f32());
    let input = std::fs::read_to_string(std::env::var("FORGOR_EMBED_IN").unwrap()).unwrap();
    let mut out = std::fs::File::create(std::env::var("FORGOR_EMBED_OUT").unwrap()).unwrap();
    let t = Instant::now();
    let items: Vec<serde_json::Value> = input.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect();
    let texts: Vec<String> = items.iter().map(|i| i["text"].as_str().unwrap().to_string()).collect();
    let vecs = models::embed::embed_with(&model, &texts).unwrap();
    let n = vecs.len();
    for (item, v) in items.iter().zip(vecs) {
        writeln!(out, "{}", serde_json::json!({ "id": item["id"], "vec": v })).unwrap();
    }
    println!("{n} texts embedded in {:.2}s", t.elapsed().as_secs_f32());
}
