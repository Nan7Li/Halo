#!/usr/bin/env bash
# One entry point: fetch a verified NAS package and invoke its installer.
set -euo pipefail
umask 077
repository=Nan7Li/Halo
release_tag=""
runtime_dir=""
check_only=0
prefer_preview=0
tag_pattern='^halo-[0-9]+\.[0-9]+\.[0-9]+-cellbridge(-preview\.[0-9]+)?$'
usage() {
  cat <<'EOF'
Halo + CellBridge 一套安装（Debian 13 / x86_64）
用法：sudo bash deploy-cellbridge-nas.sh [--tag TAG] [--preview] [--runtime-dir DIR] [--check-only]
默认获取最新正式版（没有正式版时用最新预览版），校验整包，安装服务并准备大疆运行文件。
--preview 改为获取最新预览版。
--runtime-dir 使用已有文件；否则安装器从固定来源获取。
--check-only 仅显示本机支持情况，不安装依赖、下载文件或修改服务。
首次管理员密码在本机终端输入；自动更新偏好可在 Web 系统设置修改。
EOF
}
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --tag) (($# >= 2)) || fail '--tag 缺少版本'; release_tag=$2; shift 2 ;;
    --runtime-dir) (($# >= 2)) || fail '--runtime-dir 缺少目录'; runtime_dir=$2; shift 2 ;;
    --check-only) check_only=1; shift ;;
    --preview) prefer_preview=1; shift ;;
    *) fail "未知参数：$1" ;;
  esac
done
[[ -z "$release_tag" || "$release_tag" =~ $tag_pattern ]] || fail '只接受 Halo CellBridge 发布版本'
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail '需要 Linux x86_64'
[[ -f /etc/os-release ]] || fail '无法确认系统版本'
os_id=$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')
os_version=$(sed -n 's/^VERSION_ID=//p' /etc/os-release | tr -d '"')
[[ "$os_id" == debian && "$os_version" == 13 ]] || fail '需要 Debian 13'
if ((check_only)); then
  printf 'Debian 13 / x86_64 支持本部署方式。程序、声卡和模块状态请用安装包中的只读检查工具检查。\n'
  exit 0
fi
[[ "$(id -u)" == 0 ]] || fail '请用 sudo 或 root 执行安装'
# A script piped into bash must not use that same stream as the admin password.
if [[ -t 0 ]]; then
  password_input=/dev/stdin
elif ( : </dev/tty ) 2>/dev/null; then
  password_input=/dev/tty
else
  password_input=/dev/null
  printf '无交互终端：已有管理员会保留；首次安装若需要密码将明确失败。无人值守初始化可使用包内 ./install 的 stdin 接口。\n'
fi
apt-get update
apt-get install -y curl ca-certificates jq
stage=$(mktemp -d /tmp/halo-deploy.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT
request() {
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 180 \
    --proto '=https' --proto-redir '=https' "$1" --output "$2"
}
api="https://api.github.com/repos/$repository/releases"
printf '正在查询已发布的 Halo CellBridge 融合版…\n'
if [[ -n "$release_tag" ]]; then
  request "$api/tags/$release_tag" "$stage/release.json"
else
  printf '[]\n' > "$stage/releases.json"
  page=1
  while :; do
    request "$api?per_page=100&page=$page" "$stage/page.json"
    jq -e 'type == "array"' "$stage/page.json" >/dev/null || fail '发布记录格式错误'
    jq -s '.[0] + .[1]' "$stage/releases.json" "$stage/page.json" > "$stage/merged.json"
    mv "$stage/merged.json" "$stage/releases.json"
    count=$(jq 'length' "$stage/page.json")
    ((count == 100)) || break
    # Fail closed rather than silently choosing from an incomplete history.
    ((page < 20)) || fail '发布记录超过扫描上限，请使用 --tag 指定版本'
    page=$((page + 1))
  done
  # Formal releases (halo-X.Y.Z-cellbridge) come first; previews only with
  # --preview or while no formal release exists.
  jq --argjson preview "$prefer_preview" '[.[] | select(.draft == false) |
    select(.tag_name | test("^halo-[0-9]+\\.[0-9]+\\.[0-9]+-cellbridge(-preview\\.[0-9]+)?$")) |
    . + {formal: (.tag_name | test("-preview\\.") | not),
      sort_version: (.tag_name | capture("^halo-(?<major>[0-9]+)\\.(?<minor>[0-9]+)\\.(?<patch>[0-9]+)-cellbridge(-preview\\.(?<preview>[0-9]+))?$") |
        [.major, .minor, .patch, (.preview // "0")] | map(tonumber))}] as $all |
    ($all | map(select(.formal))) as $formal |
    if $preview == 1 then ($all | map(select(.formal | not)) | max_by(.sort_version))
    elif ($formal | length) == 0 then ($all | max_by(.sort_version))
    else ($formal | max_by(.sort_version)) end' \
    "$stage/releases.json" > "$stage/release.json"
fi
jq -e --arg pattern "$tag_pattern" 'type == "object" and .draft == false and (.tag_name | test($pattern))' "$stage/release.json" >/dev/null || fail '没有可安装的已发布融合版'
selected=$(jq -r .tag_name "$stage/release.json")
printf '正在下载 %s 并校验部署包；下载失败会停止安装。\n' "$selected"
bundle=halo-cellbridge-nas-amd64.tar.gz
base="https://github.com/$repository/releases/download/$selected"
# Fixed URLs from the trusted repository: do not execute an arbitrary API-supplied URL.
request "$base/$bundle" "$stage/$bundle"
request "$base/$bundle.sha256" "$stage/$bundle.sha256"
expected=$(awk -v file="$bundle" '$2 == file && $1 ~ /^[0-9a-f]+$/ && length($1) == 64 {print $1; exit}' "$stage/$bundle.sha256")
[[ -n "$expected" ]] || fail '整包校验文件缺失有效 SHA-256'
actual=$(sha256sum "$stage/$bundle")
[[ "${actual%% *}" == "$expected" ]] || fail '整包 SHA-256 不匹配，未执行安装'
tar -tzf "$stage/$bundle" > "$stage/entries"
tar -tvzf "$stage/$bundle" > "$stage/entry-types"
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {exit 1}' "$stage/entry-types" || fail '部署包含符号链接或特殊文件，拒绝解压'
while IFS= read -r entry; do
  [[ "$entry" == halo-cellbridge-nas-amd64 || "$entry" == halo-cellbridge-nas-amd64/* ]] || fail '部署包路径不合法'
  [[ "/$entry/" != *'/../'* && "$entry" != /* ]] || fail '部署包包含越界路径'
done < "$stage/entries"
tar --no-same-owner --no-same-permissions -xzf "$stage/$bundle" -C "$stage"
install_script=$stage/halo-cellbridge-nas-amd64/install
[[ -f "$install_script" && ! -L "$install_script" ]] || fail '部署包缺少安装入口'
args=()
if [[ -n "$runtime_dir" ]]; then
  args+=(--runtime-dir "$runtime_dir")
elif [[ -f /opt/halo/qdc507/qdc507_aprv3.ko && -f /opt/halo/qdc507/qdc507_voice.ko && -f /opt/halo/qdc507/mavo-pcm-bridge.armv7 ]]; then
  args+=(--runtime-dir /opt/halo/qdc507)
else
  args+=(--fetch-runtime --runtime-dir "$stage/qdc507-runtime")
fi
printf '安装融合版 %s；Halo 和 CellBridge 共用一个服务。\n' "$selected"
bash "$install_script" "${args[@]}" < "$password_input"
