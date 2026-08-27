---
name: network-troubleshooting
description: Diagnostics for Linux network connectivity failures, packet loss, DNS resolution, firewall rules, interface issues, routing problems, and bandwidth saturation.
---

# Network Troubleshooting Skill

## 1. Interface & Link Status
```bash
ip a                                # addresses and link states
ip link show                        # MTU, state UP/DOWN, carrier
ethtool <iface> 2>/dev/null         # speed, duplex, link detected
cat /sys/class/net/<iface>/operstate
```

## 2. Connectivity Tests
```bash
ping -c 4 8.8.8.8                   # basic IP reachability (bypasses DNS)
ping -c 4 <hostname>                # tests DNS + IP reachability
traceroute -n 8.8.8.8 2>/dev/null || tracepath -n 8.8.8.8
# MTU discovery test (find fragmentation):
ping -c 3 -M do -s 1472 8.8.8.8    # 1472 + 28 byte header = 1500 byte Ethernet
```

## 3. DNS Resolution
```bash
cat /etc/resolv.conf
cat /etc/nsswitch.conf | grep hosts
nslookup <hostname>
dig <hostname> @8.8.8.8             # bypass local resolver
resolvectl status 2>/dev/null       # systemd-resolved status
# Check /etc/hosts overrides:
grep <hostname> /etc/hosts
```

## 4. Listening Ports & Active Connections
```bash
ss -tulpn                           # listening sockets with owning process
ss -tnp                             # established TCP connections
ss -s                               # summary statistics (TIME_WAIT accumulation)
netstat -s 2>/dev/null | grep -i "error\|retran\|fail" | head -n 20
```

## 5. Firewall Rules
```bash
iptables -L -n -v --line-numbers 2>/dev/null
nft list ruleset 2>/dev/null
ufw status verbose 2>/dev/null
firewall-cmd --list-all 2>/dev/null
```

## 6. Routing
```bash
ip route show
ip route get <destination-ip>       # which interface/gateway for a specific dest
ip neigh show                       # ARP cache (empty entries = L2 problem)
```

## 7. Bandwidth & Packet Loss
```bash
# Per-interface rx/tx counters (watch for errors and drops):
ip -s link show <iface>
cat /proc/net/dev
# Check for packet loss on a sustained basis:
ping -c 100 -i 0.2 <target> | tail -n 3
# Bandwidth measurement (if iperf3 available):
iperf3 -c <server> -t 10 2>/dev/null
```

## 8. TCP Connection Issues
```bash
# SYN backlog overflow (connection refused under load):
ss -lnt | awk 'NR>1 {print $2, $4}' | head -n 20   # Recv-Q > 0 = accept backlog full
sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog
# TCP retransmissions (network quality indicator):
ss -ti 2>/dev/null | grep -i retran | head -n 10
```

## 9. Packet Capture (brief, bounded)
```bash
# Capture 100 packets on an interface to a file for analysis:
timeout 10 tcpdump -i <iface> -c 100 -w /tmp/capture.pcap 2>/dev/null
tcpdump -r /tmp/capture.pcap 'tcp[tcpflags] & tcp-rst != 0' | head -n 20  # RST packets
```

## 10. Remediation Guidelines
- Distinguish application-level failures from network failures: check if `ping 8.8.8.8` works when DNS fails — it isolates DNS from routing.
- `ip neigh show` showing `FAILED` entries means ARP resolution is failing (gateway unreachable or wrong gateway IP in `/etc/resolv.conf`).
- High `TIME_WAIT` counts (`ss -s`) are usually benign but can exhaust ephemeral ports under sustained high connection rates — check `net.ipv4.ip_local_port_range`.
- Never flush `iptables -F` in production without confirming SSH access is not filtered through those rules.
