#!/usr/bin/env bash
# Finds Oxide plugins for Rust Legacy on GitHub, builds the final Oxide for Rust Legacy (March 2018) from its own
# source, and compiles every plugin the way that Oxide does. Nothing from the game or the plugins is run: the game
# DLLs are only compile references, and compiled plugins are only read as metadata. See README.md.
#
#   tools/oxide-plugin-check/run.sh [work dir]          (default analysis/oxide-plugin-check)
#   MANAGED=<rust_server_Data/Managed>                  our server's own DLLs (recommended)
#   EXTRA_MANAGED=<folder>                              extra stock DLLs for "// Reference:" lines when MANAGED is not set
#
# Needs git, python3, the .NET 8 SDK and Mono (mcs, ikdasm): apt-get install dotnet-sdk-8.0 mono-mcs mono-devel
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mkdir -p "${1:-analysis/oxide-plugin-check}" && cd "${1:-analysis/oxide-plugin-check}" && pwd)"
SERVER_HASH=ce0dd83271472454fc27ce137a9fa9d042b3a5f12fb26f1c7a67d61eea3acfbb  # tools/vanilla-patcher allowlist

# Final Oxide for Rust Legacy and the framework commits it was built with
OXIDE=(
  "OxideMod/Oxide.RustLegacy eff84ea273729d43266841962a55bb2ea24ad212"
  "OxideMod/Oxide.Core 601a58da4bf732e219c426ed90377405875589aa"
  "OxideMod/Oxide.CSharp 7b0d01c48352f9f33b9c20f0d0f26c976c2ece53"
  "OxideMod/Oxide.Unity 12bd3a88f3cf1999bca2cc52e932fc2ede21f683"
  "OxideMod/Oxide.References 68626915ebc06058fed4ccbd6f8d510f5ecbc42d"
  "OxideMod/Oxide.MySql 7b0c66b7e4b9a1a94f4f4dba1c898234c4c28560"
  "OxideMod/Oxide.SQLite 6507fc693ffd6f521b422719c14ee5723545ceca"
)
# Plugin collections found by GitHub code search for "RustLegacyPlugin" (2026-10-24)
PLUGINS=(
  "Calytic/oxideplugins 9da63dfaebec960d94645e5d38b4281bb3bd8c8d"
  "Crushedice/LatestPlugins 22de73885c5d27a1b21a80c26e7b27f621eac5a5"
  "RustServers-IO/oxideplugins 4de21d4db2d609e9e652f71bafc23c84bdba6da2"
  "strykes/Oxide2Plugins 3d31a7f8d0ec9cf0e0339be87212605deb72968a"
  "KichDM/RustLegacyPlugins eb74644ce40213de073ccb3f7c5d278ab794d6e6"
  "erikmoch/OxidePlugins de10815c4e99e146e672929c6210c1f016d4083f"
  "upperking/Old-Rust-Legacy-Plugins 0f6631cc889e7c842c85449e3d71442df49d5173"
  "g-arezi/RustLegacy---Plugins-C- e3d47cb3400ebaa4eb478f00f57fc2562cdcbe0a"
  "victor-0x29a/rust-legacy-plugins 9b0bf509fc12cc5251acf3622c36860ea96efa56"
  "shadowfearzxc/RustExtended-plugins 5a4b9a8fc7935daa1b18b5404823e69fadf43d9b"
)

fetch() {  # fetch <owner/repo> <sha> <dir>
  [ -d "$3/.git" ] && [ "$(git -C "$3" rev-parse HEAD)" = "$2" ] && return
  rm -rf "$3"; git init -q "$3"
  git -C "$3" fetch -q --depth 1 "https://github.com/$1" "$2"
  git -C "$3" -c advice.detachedHead=false checkout -q FETCH_HEAD
}
echo "== fetching Oxide and plugin collections"
mkdir -p "$W/oxide-src" "$W/plugins-src"
for e in "${OXIDE[@]}"; do set -- $e; fetch "$1" "$2" "$W/oxide-src/${1#*/}"; done
echo "{" > "$W/sources.json"; sep=""
for e in "${PLUGINS[@]}"; do set -- $e; d="${1/\//_}"; fetch "$1" "$2" "$W/plugins-src/$d"; echo "$sep \"$d\": \"$2\"" >> "$W/sources.json"; sep=","; done
echo "}" >> "$W/sources.json"

echo "== staging references"
O="$W/oxide-src"
mkdir -p "$W/refs" "$W/runtime" "$W/game" "$W/game-extra" "$W/out" "$W/bin" "$W/build/fetch"
cat > "$W/build/fetch/fetch.csproj" <<'EOF'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageDownload Include="Microsoft.NETFramework.ReferenceAssemblies.net35" Version="[1.0.3]" />
    <PackageDownload Include="Mono.Cecil" Version="[0.9.6.4]" />
    <PackageDownload Include="WebSocketSharpFork" Version="[1.0.4]" />
  </ItemGroup>
</Project>
EOF
dotnet restore -v q "$W/build/fetch" >/dev/null
NUGET="${NUGET_PACKAGES:-$HOME/.nuget/packages}"
cp "$O/Oxide.References/src/Dependencies/"{Newtonsoft.Json,protobuf-net,Mono.Posix}.dll "$W/refs/"
cp "$NUGET/mono.cecil/0.9.6.4/lib/net35/"Mono.Cecil{,.Rocks}.dll "$NUGET/websocketsharpfork/1.0.4/lib/net35/websocket-sharp.dll" "$W/refs/"
cp "$O/Oxide.MySql/Oxide.MySql/Dependencies/MySql.Data.dll" "$O/Oxide.SQLite/Oxide.SQLite/Dependencies/System.Data.SQLite.dll" "$W/refs/"
GAME=(Assembly-CSharp Facepunch.ID uLink UnityEngine)
if [ -n "${MANAGED:-}" ]; then
  for n in "${GAME[@]}"; do cp "$MANAGED/$n.dll" "$W/game/"; done
  for n in mscorlib System System.Core System.Data; do cp "$MANAGED/$n.dll" "$W/runtime/"; done
  EXTRA_MANAGED="$MANAGED"
else
  # Oxide's archived copy of the stock server DLLs (same Assembly-CSharp as ours) and the .NET 3.5 reference assemblies
  for n in "${GAME[@]}"; do cp "$O/Oxide.RustLegacy/src/Dependencies/Original/$n.dll" "$W/game/"; done
  for n in mscorlib System System.Core System.Data; do cp "$NUGET/microsoft.netframework.referenceassemblies.net35/1.0.3/build/.NETFramework/v3.5/$n.dll" "$W/runtime/"; done
fi
have="$(sha256sum "$W/game/Assembly-CSharp.dll" | cut -d' ' -f1)"
[ "$have" = "$SERVER_HASH" ] || echo "WARNING: Assembly-CSharp.dll is $have, not our server build $SERVER_HASH"
if [ -n "${EXTRA_MANAGED:-}" ]; then
  for f in "$EXTRA_MANAGED"/Facepunch.*.dll "$EXTRA_MANAGED"/Assembly-*.dll "$EXTRA_MANAGED"/Google.ProtocolBuffers*.dll \
           "$EXTRA_MANAGED"/EasyRoads3D.dll "$EXTRA_MANAGED"/dfScriptLite.dll "$EXTRA_MANAGED"/UnityEngine.*.dll; do
    [ -f "$f" ] || continue; n="$(basename "$f")"
    case "$n" in Assembly-CSharp.dll|Facepunch.ID.dll) ;; *) cp "$f" "$W/game-extra/";; esac
  done
fi

echo "== building Oxide for Rust Legacy"
B="$W/build"
cat > "$B/Directory.Build.props" <<EOF
<Project>
  <PropertyGroup>
    <TargetFramework>net35</TargetFramework>
    <LangVersion>latest</LangVersion>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <NoWarn>\$(NoWarn);CS0618;CS0612;CS1591;CS0436;CS0108;CS0114</NoWarn>
    <OutputPath>$W/out/</OutputPath>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies.net35" Version="1.0.3" PrivateAssets="all" />
  </ItemGroup>
  <!-- Oxide.References merged these with ILRepack and gave them the extern alias "Oxide" -->
  <ItemGroup Condition="'\$(MSBuildProjectName)' != 'fetch'">
EOF
for n in Newtonsoft.Json protobuf-net Mono.Cecil Mono.Cecil.Rocks websocket-sharp Mono.Posix; do
  echo "    <Reference Include=\"$n\"><HintPath>$W/refs/$n.dll</HintPath><Aliases>global,Oxide</Aliases></Reference>" >> "$B/Directory.Build.props"
done
printf '  </ItemGroup>\n</Project>\n' >> "$B/Directory.Build.props"
project() {  # project <name> <source dir> <extra references xml>
  mkdir -p "$B/$1"
  cat > "$B/$1/$1.csproj" <<EOF
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><AssemblyName>$1</AssemblyName></PropertyGroup>
  <ItemGroup>
    <Compile Include="$2/**/*.cs" Exclude="$2/obj/**;$2/Commands.cs" />
    $3
  </ItemGroup>
</Project>
EOF
  dotnet build "$B/$1" -c Release -v q -nologo | grep -E " error |rror\(s\)" || true
  [ -f "$W/out/$1.dll" ] || { echo "build of $1 failed"; exit 1; }
}
ref() { echo "<Reference Include=\"$1\"><HintPath>$2</HintPath><Private>false</Private></Reference>"; }
project Oxide.Core "$O/Oxide.Core/Oxide.Core" "<Reference Include=\"System.Data\" /><Reference Include=\"System.Xml\" />"
project Oxide.CSharp "$O/Oxide.CSharp/Oxide.CSharp" "$(ref Oxide.Core "$W/out/Oxide.Core.dll")<Reference Include=\"System.Data\" />"
project Oxide.Unity "$O/Oxide.Unity/Oxide.Unity" "$(ref Oxide.Core "$W/out/Oxide.Core.dll")$(ref UnityEngine "$W/game/UnityEngine.dll")"
project Oxide.MySql "$O/Oxide.MySql/Oxide.MySql" "$(ref Oxide.Core "$W/out/Oxide.Core.dll")$(ref MySql.Data "$W/refs/MySql.Data.dll")<Reference Include=\"System.Data\" />"
project Oxide.SQLite "$O/Oxide.SQLite/Oxide.SQLite" "$(ref Oxide.Core "$W/out/Oxide.Core.dll")$(ref System.Data.SQLite "$W/refs/System.Data.SQLite.dll")<Reference Include=\"System.Data\" />"
# Oxide compiles plugins against its patched Assembly-CSharp: apply RustLegacy.opj's field modifiers and added field
dotnet build "$HERE/opjpatch" -c Release -v q -nologo -o "$W/bin/opjpatch" | grep -E " error " || true
dotnet build "$HERE/inspect" -c Release -v q -nologo -o "$W/bin/inspect" | grep -E " error " || true
cp "$W/game/Assembly-CSharp.dll" "$W/game/Assembly-CSharp.original.dll"
dotnet "$W/bin/opjpatch/opjpatch.dll" "$O/Oxide.RustLegacy/resources/RustLegacy.opj" "$W/game/Assembly-CSharp.original.dll" "$W/out/Oxide.Core.dll" "$W/game/Assembly-CSharp.dll"
rm "$W/game/Assembly-CSharp.original.dll"
G=""; for n in "${GAME[@]}"; do G="$G$(ref "$n" "$W/game/$n.dll")"; done
project Oxide.RustLegacy "$O/Oxide.RustLegacy/src" "$(ref Oxide.Core "$W/out/Oxide.Core.dll")$(ref Oxide.CSharp "$W/out/Oxide.CSharp.dll")$(ref Oxide.Unity "$W/out/Oxide.Unity.dll")$G"

echo "== compiling plugins"
python3 -I "$HERE/hooks.py" "$O" "$W/hooks.json"
python3 -I "$HERE/corpus.py" "$W/plugins-src" "$W/corpus.json"
python3 -I "$HERE/compile.py" "$W" "$W/plugins-src"
python3 -I "$HERE/classify.py" "$W" "$W/plugins-src"
python3 -I "$HERE/report.py" "$W" "$W/plugins-src"
python3 -I "$HERE/check_bundle.py" "$W" "$W/bundle/oxide/plugins"
python3 -I "$HERE/check_bundle.py" "$W" "$W/bundle-shortlist/oxide/plugins"
echo "== done: $W/plugins.csv, $W/plugins.md, $W/shortlist.md, $W/all-files.csv, $W/bundle/oxide/plugins, $W/bundle-shortlist/oxide"
