# Container Installation

This guide describes how to run Node-RED in Docker for local development, how to install this repository into the container, and how to refresh the installed node after code changes.

---

## Contents

1. [Install the Node-RED Container](#install-the-node-red-container)
2. [Copy and Install This Node in the Container](#copy-and-install-this-node-in-the-container)
3. [Update the Installed Node After Code Changes](#update-the-installed-node-after-code-changes)
4. [Notes and Troubleshooting](#notes-and-troubleshooting)

---

## Install the Node-RED Container

Use this section if you do not already have a running Node-RED container.

### Prerequisites

- Docker must be installed and available in your environment.
- On Windows with WSL, the commands below can be run from a WSL shell.

### Create a persistent data volume

```bash
docker volume create node_red_data
```

The volume stores the Node-RED user directory under `/data`, including flows, credentials, installed palette nodes, and settings.

### Start the container

```bash
docker run -d \
  --name mynodered \
  -p 1880:1880 \
  -v node_red_data:/data \
  --restart unless-stopped \
  nodered/node-red
```

### Verify the container

```bash
docker ps --filter name=mynodered
docker logs --tail 50 mynodered
```

When startup is complete, Node-RED is available at `http://localhost:1880`.

---

## Copy and Install This Node in the Container

For active local development, copy the current workspace into the container and install it from that copied path. This is more useful than cloning a Git repository directly inside the container, because it installs the exact code currently present in your local workspace.

### 1. Ensure the container is running

```bash
docker start mynodered
```

### 2. Create a development folder inside the Node-RED user directory

```bash
docker exec mynodered sh -lc 'mkdir -p /data/dev'
```

### 3. Copy the local repository into the container

Example for WSL with a Windows workspace mounted under `/mnt/c/...`:

```bash
docker cp \
  "/mnt/c/path/to/your/node-red-contrib-opcua-pro/." \
  mynodered:/data/dev/node-red-contrib-opcua-pro
```

If you are already in the repository root inside WSL, you can also use:

```bash
docker cp . mynodered:/data/dev/node-red-contrib-opcua-pro
```

### 4. Install the copied package into `/data`

```bash
docker exec mynodered sh -lc 'cd /data && npm install ./dev/node-red-contrib-opcua-pro'
```

This adds the package to the Node-RED user directory and makes it available as a local palette module.

### 5. Restart Node-RED so the palette reloads

```bash
docker restart mynodered
```

### 6. Verify the installation

```bash
docker exec mynodered sh -lc 'cd /data && npm list --depth=0 node-red-contrib-opcua-pro'
docker logs --tail 100 mynodered
```

The expected `npm list` output contains a line similar to:

```text
node-red-contrib-opcua-pro@0.1.0 -> ./dev/node-red-contrib-opcua-pro
```

Then open `http://localhost:1880` and check that the OPC UA nodes are available in the Node-RED palette.

---

## Update the Installed Node After Code Changes

If you changed the code in this repository, refresh the copy inside the container and reinstall it.

### Recommended update sequence

```bash
docker exec mynodered sh -lc 'rm -rf /data/dev/node-red-contrib-opcua-pro && mkdir -p /data/dev'

docker cp \
  "/mnt/c/path/to/your/node-red-contrib-opcua-pro/." \
  mynodered:/data/dev/node-red-contrib-opcua-pro

docker exec mynodered sh -lc 'cd /data && npm install ./dev/node-red-contrib-opcua-pro'

docker restart mynodered
```

### Post-update verification

```bash
docker exec mynodered sh -lc 'cd /data && npm list --depth=0 node-red-contrib-opcua-pro'
docker logs --tail 100 mynodered
```

Use this update flow whenever you change JavaScript, HTML, package metadata, or any other files that affect Node-RED node loading.

---

## Notes and Troubleshooting

### Why copy instead of `git clone` in the container?

- `docker cp` installs your current local working tree, including uncommitted changes.
- `git clone` inside the container only gives you a repository snapshot and does not stay in sync with your local edits.
- For iterative development, copying the workspace is the simpler and more reliable workflow.

### The container exists but is stopped

Start it again with:

```bash
docker start mynodered
```

### The package does not appear in `npm list`

Check that the copied directory really contains `package.json`:

```bash
docker exec mynodered sh -lc 'ls -la /data/dev/node-red-contrib-opcua-pro && test -f /data/dev/node-red-contrib-opcua-pro/package.json && echo ok'
```

Then rerun the install step:

```bash
docker exec mynodered sh -lc 'cd /data && npm install ./dev/node-red-contrib-opcua-pro'
```

### Node-RED starts, but the node does not show in the palette

Inspect the startup logs:

```bash
docker logs --tail 200 mynodered
```

Look for palette loading errors, missing dependencies, or syntax errors in the node files.