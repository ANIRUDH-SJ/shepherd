# 21 — Live state subscriptions over a local socket

Queries answer “what is true now?” Subscriptions answer “tell me when that answer
changes.” A reliable UI automation API normally needs both: a snapshot for a
known starting point and ordered deltas for efficient ongoing observation.

## 21.1 The snapshot-plus-delta model

Starting with events alone creates a race. State can change between a client's
initial query and the moment its event listener becomes active. Starting with one
atomic subscription response avoids that gap:

```text
client                 server                    state owner
  | subscribe(filters)   |                           |
  |--------------------->|                           |
  | snapshot, sequence=0 |                           |
  |<---------------------|                           |
  |                      |<------ state changes -----|
  | delta, sequence=1    |                           |
  |<---------------------|                           |
```

The snapshot is a complete projection of the filters. Every later event transforms
that projection into the next one.

## 21.2 Upserts and tombstones

An upsert means “insert this identity if absent, otherwise replace it.” It makes
creation and update share one client operation. A tombstone is the stable identity
of a record to remove.

Do not treat removal as only process exit. A record leaves a filtered projection
when it expires, is cleared, moves outside the filter, or falls outside a bounded
result page. The client should apply both arrays, then replace summary metadata.

## 21.3 Sequence numbers detect uncertainty

Every subscription begins at sequence zero. Each emitted delta increments by one.
If a client observes 7 after 5, it cannot safely invent event 6. The recovery rule
is simple: reconnect and accept a new snapshot.

Sequence numbers are scoped to a subscription, not global application history.
This keeps them cheap and prevents unrelated consumers from affecting one another.
They detect gaps; they are not durable event-log offsets.

## 21.4 Reuse validation and filtering

A subscription API should not grow a second query language. Run the same parser and
projection used by list/snapshot endpoints, then store the normalized query. This
keeps comma-separated CLI values, enum validation, timestamp cursors, limits, and
workspace resolution identical across one-shot and streaming consumers.

In cmux-linux, the renderer reducer remains authoritative. Electron main receives a
structured mirror, applies each saved query, and compares the resulting projection
with the subscriber's previous projection. Terminal text is never scraped.

## 21.5 Backpressure is part of correctness

`socket.write` can queue data faster than a client reads it. Without a policy, one
stalled observer can grow the desktop process until it crashes. Common policies are:

1. block the producer — unsuitable when the producer is the UI state path;
2. drop individual events — requires more complex gap signalling;
3. disconnect the slow consumer — simple when reconnect snapshots are available.

cmux-linux chooses option 3 at 1 MiB of queued output and also caps the process at
64 subscriptions. Reconnection is safe because sequence-zero always carries a full
snapshot.

## 21.6 NDJSON framing still applies

A long-lived stream does not change Unix socket semantics. One `data` callback may
contain half an event or ten events. Both server and client use newline-delimited
JSON and retain incomplete bytes until another chunk arrives.

Normal replies use `{id, result}` or `{id, error}`. Asynchronous updates use:

```json
{ "event": "agent-update", "subscriptionId": 3, "data": { "version": 1, "sequence": 1 } }
```

The separate envelope prevents an event from being mistaken for a second response
to the subscribe request. The machine-readable protocol schema publishes both
envelope shapes.

## 21.7 Lifecycle and cleanup

Tie subscription lifetime to connection lifetime whenever one local stream is all
the client needs. The server removes subscriber records on `close`, destroys them
during shutdown, and does not need leases or heartbeat cleanup for dead clients.

A future multiplexed SDK could add explicit unsubscribe. It is not required for a
CLI whose Ctrl+C closes its only connection.

## 21.8 Why not polling or a durable broker?

Polling is easy but introduces repeated full responses and a latency/traffic
tradeoff. A durable broker offers replay but adds persistence, retention,
acknowledgement, and operational complexity. For process-local ephemeral UI state,
snapshot plus bounded socket deltas gives recovery without a second state system.

## 21.9 Client algorithm

```text
connect and subscribe
replace local projection with snapshot; expected = 1
for each event:
  if sequence != expected: reconnect
  remove every tombstone
  insert/replace every upsert
  replace summary metadata
  expected += 1
```

## Checkpoint

1. What race does the initial subscription snapshot eliminate?
2. Why can a filter change produce a tombstone without deleting the real record?
3. Why is disconnecting a slow client acceptable here?
4. What is the recovery action after a sequence gap?
5. Why does a stream still need a buffer-and-split framing loop?
