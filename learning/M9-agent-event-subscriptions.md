# M9 — Live agent event subscriptions

## The goal

M7 made agent state semantic and queryable, but a consumer still had to poll
`agent-snapshot`. M9 adds one long-lived socket request that returns a filtered
snapshot and then streams only meaningful changes.

## What changed

- `src/main/socket.ts` owns live subscriptions and publishes bounded deltas.
- `src/shared/agentProtocol.ts` describes the subscription and event envelopes.
- `bin/cmux.js` exposes the stream as `cmux watch-agents [query flags]`.
- The socket, protocol, and CLI tests cover snapshot, update, removal, and flag mapping.

## Walking through the code

### 1. A subscription reuses the query contract

`subscribe-agents` calls `normalizeAgentQuery`, exactly like `list-agents` and
`agent-snapshot`. Provider, state, activity, blocked reason, source, session,
surface, timestamp, workspace, and limit therefore mean the same thing everywhere.
An invalid filter is rejected before a subscriber is stored.

If `workspace` is present, the socket resolves its name or id once and stores the
stable workspace id. That prevents a later rename from silently changing the
subscription target.

### 2. The first response is a reconnectable snapshot

The normal `{id, result}` reply contains:

```text
subscriptionId + protocol version + sequence 0
└── snapshot
    ├── generatedAt + active workspace + workspace identities
    └── agents + matched/truncated + semantic summary
```

The client can render correct state immediately. It does not have to race a query
against the first event.

### 3. Renderer mirror updates drive deltas

`updateWorkspaceMirror` remains the main process's read-only copy of renderer
state. After replacing the mirror it calls `publishAgentUpdates`. Each subscriber
reruns its saved query. If the complete query result did not change, nothing is
written.

When it did change, the server compares the old and new visible agent sets:

- `upsert` contains new or changed records;
- `removed` contains agent-id tombstones;
- `matched`, `truncated`, and `summary` replace the old query metadata;
- `sequence` increments exactly once for that emitted delta.

Tombstones matter because an agent can disappear through explicit clear, terminal
exit, workspace close, expiry, or because it stopped matching a filter.

### 4. Connection lifetime is subscription lifetime

There is no separate unsubscribe command. Closing the Unix socket removes every
subscription on that connection. `stopSocketServer` also destroys subscription
connections before removing the socket file.

Two resource bounds protect the desktop app:

- at most 64 live subscriptions;
- a connection with more than 1 MiB queued output is disconnected as a slow consumer.

Each query already has the shared maximum of 1,000 visible agent records.

### 5. The CLI keeps reading complete frames

Normal `cmux` commands still stop after one reply. `watch-agents` maps to
`subscribe-agents`, keeps the connection open, and prints each response/event as
one JSON line. Its parser now loops over every newline-delimited frame in a data
chunk, which is required because Unix sockets are byte streams rather than message
queues.

Example:

```bash
cmux watch-agents --state blocked,done --provider codex,claude
```

Stop it with Ctrl+C; closing the client connection performs server cleanup.

## What the tests prove

The socket regression test opens a real Unix socket, subscribes with a provider
filter, checks sequence-zero snapshot state, changes a record, checks sequence-one
upsert state, removes it, and checks the tombstone. It then restores the fixture so
older inspection and focus tests remain independent.

Protocol tests prove discovery/schema exposure. CLI tests prove that
`watch-agents` maps to the subscription method without losing query flags.

## Deliberately deferred

- Durable replay across process restarts. Reconnect with a fresh snapshot instead.
- Acknowledgements and per-event persistence. The local UI state is authoritative.
- Unlimited buffering. Slow clients are disconnected and must reconnect.

## Checkpoint

1. Why must a subscriber receive a snapshot before deltas?
2. How can a still-running agent produce a removal tombstone?
3. What does a sequence gap tell a client to do?
4. Why is socket close sufficient for unsubscribe?
