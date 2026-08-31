# shadow-sentinel：值班哨容器化（2026-08-31 造物主谕「进程尽入 docker」）。
# 宿主散养史：schtask 动作注册错指 pythonw、PYTHONHOME 毒静默崩、日志靠外壳重定向全丢。
# 容器化三件套：docker-cli（挂 /var/run/docker.sock）、python3 标准库、restart 政策自愈。
FROM alpine:3.20
RUN apk add --no-cache docker-cli python3 tzdata
ENV TZ=Asia/Shanghai
CMD ["sh", "-c", "while true; do python3 /opt/mc_oncall.py; sleep 120; done"]
