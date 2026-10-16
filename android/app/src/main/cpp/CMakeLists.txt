cmake_minimum_required(VERSION 3.22.1)
project(asciipaper C)
add_library(asciipaper SHARED scene.c ../../../../../native/presets.c)
target_include_directories(asciipaper PRIVATE ../../../../../native)
target_link_libraries(asciipaper GLESv2 m)
target_compile_options(asciipaper PRIVATE -Wall -Wextra -Wno-unused-parameter)
# Android 15+ devices may use 16 KB memory pages; Play requires the ELF segments to be
# aligned accordingly. The NDK below r28 does not set this by default.
target_link_options(asciipaper PRIVATE "-Wl,-z,max-page-size=16384")
