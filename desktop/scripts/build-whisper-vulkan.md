# Vulkan whisper-server (AMD / Intel GPUs)

whisper.cpp publishes no Windows Vulkan build, so Dispatch ships its own in
`resources/whisper-vulkan/whisper-server.exe` (not in git, 51 MB; bundled by electron-builder).
Built 2026-11-12 from tag b5454, the same tag as the CUDA/CPU downloads in electron/whisper.cjs.

Toolchain (no admin needed except the Vulkan SDK): WinLibs MinGW-w64 UCRT (gcc + ninja), CMake, Vulkan SDK 1.4.363.
Use a short source path (e.g. D:\wb): long paths break the shader generator sub-build. Put MinGW first on PATH,
otherwise vulkan-shaders-gen loads another libstdc++ and crashes (0xC0000139).

    git clone --depth 1 --branch b5454 https://github.com/ggml-org/whisper.cpp D:\wb
    $env:Path = "<mingw64\bin>;C:\VulkanSDK\<ver>\Bin;C:\Program Files\CMake\bin;C:\Windows\System32;C:\Windows"
    cmake -S D:\wb -B D:\wb\build -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF -DCMAKE_EXE_LINKER_FLAGS=-static
    cmake --build D:\wb\build -j 12 --target whisper-server

The result depends only on Windows DLLs and vulkan-1.dll (installed by every GPU driver).
Measured on an RTX 3070 Ti through Vulkan: 0.18 s for 5 s of speech with large-v3-turbo.
