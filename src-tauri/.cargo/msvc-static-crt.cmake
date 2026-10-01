# Used for CMake builds on Windows (llama.cpp): link the static C runtime (/MT),
# like sherpa-onnx's prebuilt libraries. See config.toml next to this file.
cmake_policy(SET CMP0091 NEW)
set(CMAKE_POLICY_DEFAULT_CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
