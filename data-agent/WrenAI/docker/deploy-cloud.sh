#!/bin/bash
# 公司云主机一键部署脚本
#
# 使用方式:
#   bash docker/deploy-cloud.sh build    # 构建镜像
#   bash docker/deploy-cloud.sh up       # 启动服务
#   bash docker/deploy-cloud.sh rebuild  # 构建 + 启动
#   bash docker/deploy-cloud.sh down     # 停止
#   bash docker/deploy-cloud.sh reset    # 全量清库重来
#   bash docker/deploy-cloud.sh logs     # 查看 ai-service 日志
#
# 前提:
#   1. socat 已安装: apt install socat
#   2. cntlm 已运行在 127.0.0.1:3128
#   3. iptables -P FORWARD ACCEPT（每次 Docker 重启后）
#   4. wren-ui node_modules 已在宿主机预装（见 README）
#   5. docker/.env 和 docker/config.yaml 已准备好

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRENAI_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$SCRIPT_DIR"
PROXY_ADDR="172.17.0.1:3128"
CNTLM_ADDR="127.0.0.1:3128"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "── $1"; }

# ─── 前置检查 ───
check_prereqs() {
    info "检查前置条件"

    # cntlm
    nc -z 127.0.0.1 3128 2>/dev/null && ok "cntlm 代理运行中" || fail "cntlm 未运行在 127.0.0.1:3128"

    # .env
    [ -f "$DOCKER_DIR/.env" ] && ok "docker/.env 存在" || fail "docker/.env 不存在，请先 cp .env.cloud .env"

    # config.yaml
    [ -f "$DOCKER_DIR/config.yaml" ] && ok "docker/config.yaml 存在" || fail "docker/config.yaml 不存在，请先 cp config.yaml.cloud config.yaml"

    # trace_callback.py
    [ -f "$DOCKER_DIR/trace_callback.py" ] && ok "trace_callback.py 存在" || fail "trace_callback.py 不存在"

    # iptables
    iptables -L FORWARD 2>/dev/null | grep -q "ACCEPT" && ok "FORWARD 链允许" || echo "⚠️  建议运行: iptables -P FORWARD ACCEPT"
}

# ─── socat 代理转发 ───
start_socat() {
    if ss -tln | grep -q "$PROXY_ADDR"; then
        info "socat 已在运行"
    else
        info "启动 socat 转发 ($CNTLM_ADDR → $PROXY_ADDR)"
        socat TCP-LISTEN:3128,bind=172.17.0.1,fork,reuseaddr TCP:$CNTLM_ADDR &
        sleep 1
        ok "socat 已启动"
    fi
}

stop_socat() {
    pkill -f "socat.*3128" 2>/dev/null && ok "socat 已停止" || info "socat 未运行"
}

# ─── 构建镜像 ───
do_build() {
    check_prereqs
    start_socat

    info "构建 wren-ui 镜像"
    cd "$WRENAI_DIR/wren-ui"
    DOCKER_BUILDKIT=0 docker build \
        --build-arg HTTP_PROXY=http://$PROXY_ADDR \
        --build-arg HTTPS_PROXY=http://$PROXY_ADDR \
        -t wrenai-wren-ui:latest -f Dockerfile.cloud .
    ok "wren-ui 构建完成"

    info "构建 wren-ai-service 镜像"
    cd "$WRENAI_DIR/wren-ai-service"
    DOCKER_BUILDKIT=0 docker build \
        --build-arg HTTP_PROXY=http://$PROXY_ADDR \
        --build-arg HTTPS_PROXY=http://$PROXY_ADDR \
        -t wrenai-wren-ai-service:latest -f docker/Dockerfile.cloud .
    ok "wren-ai-service 构建完成"

    stop_socat
}

# ─── 启动 ───
do_up() {
    cd "$DOCKER_DIR"
    mkdir -p data/qdrant
    docker compose -f docker-compose-dev.yaml up -d
    ok "所有服务已启动"
    echo ""
    echo "WrenAI UI: http://$(hostname -I | awk '{print $1}'):3000"
}

# ─── 停止 ───
do_down() {
    cd "$DOCKER_DIR"
    docker compose -f docker-compose-dev.yaml down
    ok "所有服务已停止"
}

# ─── 全量清库 ───
do_reset() {
    cd "$DOCKER_DIR"
    info "停止服务并清除所有数据"
    docker compose -f docker-compose-dev.yaml down
    rm -rf "$DOCKER_DIR/data"
    ok "清库完成，重新启动需要走完整导入流程（见 README）"
}

# ─── 日志 ───
do_logs() {
    cd "$DOCKER_DIR"
    docker compose -f docker-compose-dev.yaml logs -f wren-ai-service
}

# ─── 入口 ───
case "${1:-help}" in
    build)   do_build ;;
    up)      do_up ;;
    rebuild) do_build && do_up ;;
    down)    do_down ;;
    reset)   do_reset ;;
    logs)    do_logs ;;
    *)
        echo "用法: bash docker/deploy-cloud.sh {build|up|rebuild|down|reset|logs}"
        echo ""
        echo "  build    构建 wren-ui + wren-ai-service 镜像"
        echo "  up       启动所有服务"
        echo "  rebuild  构建 + 启动"
        echo "  down     停止所有服务"
        echo "  reset    全量清库（删除数据卷）"
        echo "  logs     查看 ai-service 实时日志"
        ;;
esac
