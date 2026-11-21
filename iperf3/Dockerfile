# iperf3 server for the Wi-Fi survey (throughput measurements from the laptop).
FROM alpine:3.20
RUN apk add --no-cache iperf3
USER nobody
EXPOSE 5201/tcp 5201/udp
# --forceflush keeps `docker logs` readable; one test at a time is iperf3's design.
ENTRYPOINT ["iperf3", "--server", "--forceflush"]
