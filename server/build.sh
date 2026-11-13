#!/bin/sh
# 编译评论服务：只需要 JDK 21，不下载任何依赖。生成 build/blog-server.jar
set -eu
cd "$(dirname "$0")"
rm -rf build/classes
mkdir -p build/classes
javac --release 21 -encoding UTF-8 -Xlint:all -Werror -d build/classes $(find src -name '*.java')
printf 'Main-Class: blog.server.Main\n' > build/manifest.txt
jar --create --file build/blog-server.jar --manifest build/manifest.txt -C build/classes .
echo "已生成 $(pwd)/build/blog-server.jar"
