---
name: user-group-management
description: Workflows for managing Linux users and groups — creating, modifying, locking accounts, auditing login history, managing SSH keys, and investigating privilege escalation paths.
---

# User & Group Management Skill

## 1. Inspect Users & Groups
```bash
cat /etc/passwd | awk -F: '{print $1, $3, $7}'   # username, UID, shell
cat /etc/group
getent passwd <username>                           # single user lookup (includes LDAP/NIS)
getent group <groupname>
id <username>                                      # all groups for a user
```

## 2. Create & Modify Users
```bash
# Create user with home directory and default shell:
useradd -m -s /bin/bash -c "Full Name" <username>
# Set or change password:
passwd <username>
# Modify user attributes:
usermod -c "New Comment" <username>               # change GECOS/comment
usermod -s /bin/zsh <username>                    # change login shell
usermod -aG <group> <username>                    # add to supplementary group (no -a = replace all)
usermod -L <username>                             # lock account
usermod -U <username>                             # unlock account
```

## 3. Create & Modify Groups
```bash
groupadd <groupname>
groupdel <groupname>
gpasswd -a <user> <group>                         # add user to group
gpasswd -d <user> <group>                         # remove user from group
gpasswd -M user1,user2 <group>                    # set full member list
```

## 4. Delete Users
```bash
userdel <username>                                # remove user only
userdel -r <username>                             # remove user + home directory + mail spool
# Check for orphaned files after deletion:
find / -nouser -o -nogroup 2>/dev/null | head -n 20
```

## 5. Password & Account Expiry
```bash
chage -l <username>                               # show account aging info
chage -E 2025-12-31 <username>                    # set account expiry date
chage -M 90 <username>                            # max password age 90 days
chage -d 0 <username>                             # force password change on next login
passwd -l <username>                              # lock (prepends ! to shadow hash)
passwd -u <username>                              # unlock
cat /etc/shadow | awk -F: '$2=="!!" || $2=="!" {print $1, "LOCKED"}'
```

## 6. SSH Key Management
```bash
# Generate a key pair (on the client):
ssh-keygen -t ed25519 -C "comment@host" -f ~/.ssh/id_ed25519
# Install public key on remote server:
ssh-copy-id -i ~/.ssh/id_ed25519.pub <user>@<host>
# Manual installation:
install -d -m 700 /home/<user>/.ssh
cat <pubkey> >> /home/<user>/.ssh/authorized_keys
chown -R <user>:<user> /home/<user>/.ssh
chmod 600 /home/<user>/.ssh/authorized_keys
# Audit all authorized_keys:
find /home /root -name "authorized_keys" 2>/dev/null | while read f; do
  echo "=== $f ==="; cat "$f"; done
```

## 7. Login & Session Audit
```bash
last -a | head -n 30                              # recent successful logins with hostname
lastb | head -n 20                                # failed login attempts
who                                               # currently logged-in users
w                                                 # who + what they are running
loginctl list-sessions 2>/dev/null               # systemd session list
lastlog | grep -v "Never"                         # last login per user (exclude never-logged-in)
```

## 8. Privilege Escalation Audit
```bash
# Who can sudo:
grep -E "^[^#]" /etc/sudoers /etc/sudoers.d/* 2>/dev/null
# Accounts with UID 0:
awk -F: '$3==0' /etc/passwd
# Members of privileged groups:
getent group sudo wheel adm staff 2>/dev/null
# NOPASSWD sudo entries (high risk):
grep -i nopasswd /etc/sudoers /etc/sudoers.d/* 2>/dev/null
```

## 9. Remediation Guidelines
- Always use `usermod -aG` (with `-a`) when adding to a group; omitting `-a` replaces all supplementary groups.
- Never edit `/etc/passwd` or `/etc/shadow` directly — use `usermod`, `passwd`, `chage`.
- Lock (`-L`) rather than delete accounts for former employees until data retention review is complete.
- `NOPASSWD` sudo entries are high-risk; document each one with a comment in `/etc/sudoers.d/` justifying the exception.
