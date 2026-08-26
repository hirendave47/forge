---
name: kubernetes-investigation
description: Diagnostics for Kubernetes pods in CrashLoopBackOff, Pending, ImagePullBackOff, and node resource pressure.
---

# Kubernetes Investigation Skill

## 1. Cluster & Node Overview
```bash
kubectl get nodes -o wide
kubectl top nodes 2>/dev/null
```

## 2. Pod Health & Failed Workloads
```bash
kubectl get pods -A --field-selector status.phase!=Running,status.phase!=Succeeded
kubectl get events -A --sort-by='.metadata.creationTimestamp' | tail -n 30
```

## 3. Investigating Pod Failures
```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --tail=100
kubectl logs <pod-name> -n <namespace> --previous --tail=100
```
