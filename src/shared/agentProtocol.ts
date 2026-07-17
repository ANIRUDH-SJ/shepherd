import {
  AGENT_ACTIVITIES,
  AGENT_BLOCK_REASONS,
  AGENT_PROVIDERS,
  AGENT_STATES,
  type AgentProvider
} from './agent'
import {
  DEFAULT_AGENT_QUERY_LIMIT,
  DEFAULT_AGENT_INSPECT_BYTES,
  DEFAULT_AGENT_INSPECT_LINES,
  DEFAULT_AGENT_WAIT_TIMEOUT_MS,
  MAX_AGENT_INSPECT_BYTES,
  MAX_AGENT_INSPECT_LINES,
  MAX_AGENT_LIFECYCLE_MS,
  MAX_AGENT_QUERY_LIMIT,
  MAX_AGENT_WAIT_TIMEOUT_MS,
  MAX_TERMINAL_CAPTURE_BYTES
} from './agentLimits'

export const AGENT_PROTOCOL_VERSION = 1

export const AGENT_PROTOCOL_METHODS = [
  'agent-report',
  'agent-clear',
  'list-agents',
  'agent-snapshot',
  'subscribe-agents',
  'focus-agent',
  'inspect-agent',
  'wait-agent',
  'agent-schema',
  'agent-capabilities'
] as const

const stringField = (maxLength: number): Record<string, unknown> => ({
  type: 'string',
  minLength: 1,
  maxLength
})

const integerInput = (
  minimum: number,
  maximum?: number,
  defaultValue?: number
): Record<string, unknown> => ({
  oneOf: [
    {
      type: 'integer',
      minimum,
      ...(maximum === undefined ? {} : { maximum })
    },
    {
      type: 'string',
      pattern: '^\\d+$',
      description: `CLI numeric string with the same ${minimum}${maximum === undefined ? '+' : `..${maximum}`} bounds`
    }
  ],
  ...(defaultValue === undefined ? {} : { default: defaultValue })
})

const enumListField = (values: readonly string[]): Record<string, unknown> => {
  const choice = `(?:${values.join('|')})`
  return {
    oneOf: [
      { type: 'string', pattern: `^${choice}(?:,\\s*${choice})*$` },
      {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: values }
      }
    ]
  }
}

const queryProperties = {
  workspace: stringField(200),
  provider: enumListField(AGENT_PROVIDERS),
  state: enumListField(AGENT_STATES),
  activity: enumListField(AGENT_ACTIVITIES),
  reason: enumListField(AGENT_BLOCK_REASONS),
  source: stringField(200),
  sessionId: stringField(200),
  surfaceId: stringField(200),
  updatedAfter: integerInput(0),
  limit: integerInput(1, MAX_AGENT_QUERY_LIMIT, DEFAULT_AGENT_QUERY_LIMIT)
}

const queryResult = {
  type: 'object',
  required: ['agents', 'matched', 'truncated', 'summary'],
  properties: {
    agents: { type: 'array', items: { $ref: '#/$defs/agentRecord' } },
    matched: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
    summary: { $ref: '#/$defs/agentSummary' }
  }
}

export const AGENT_PROTOCOL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cmux-linux:agent-protocol:v1',
  title: 'cmux-linux semantic agent protocol',
  version: AGENT_PROTOCOL_VERSION,
  transport: {
    kind: 'unix-domain-socket',
    framing: 'newline-delimited-json',
    envelope: {
      request: '{id, method, params}',
      response: '{id, result} | {id, error}',
      event: '{event, subscriptionId, data}'
    }
  },
  methods: {
    'agent-report': {
      kind: 'command',
      params: {
        type: 'object',
        required: ['provider', 'state', 'source', 'surfaceId'],
        properties: {
          agentId: stringField(200),
          provider: { $ref: '#/$defs/agentProvider' },
          displayName: stringField(80),
          workspace: stringField(200),
          surfaceId: stringField(200),
          state: { $ref: '#/$defs/agentState' },
          activity: { $ref: '#/$defs/agentActivity' },
          reason: { $ref: '#/$defs/agentBlockReason' },
          message: stringField(240),
          source: stringField(80),
          sessionId: stringField(200),
          revision: integerInput(0),
          staleAfterMs: integerInput(1, MAX_AGENT_LIFECYCLE_MS),
          ttlMs: integerInput(1, MAX_AGENT_LIFECYCLE_MS)
        },
        allOf: [
          {
            if: { required: ['activity'] },
            then: { properties: { state: { const: 'working' } } }
          },
          {
            if: { required: ['reason'] },
            then: { properties: { state: { const: 'blocked' } } }
          }
        ]
      },
      result: { $ref: '#/$defs/okResult' }
    },
    'agent-clear': {
      kind: 'command',
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: stringField(200), source: stringField(80) }
      },
      result: { $ref: '#/$defs/okResult' }
    },
    'list-agents': {
      kind: 'query',
      params: { type: 'object', properties: queryProperties },
      result: queryResult
    },
    'agent-snapshot': {
      kind: 'query',
      params: { type: 'object', properties: queryProperties },
      result: {
        allOf: [
          queryResult,
          {
            type: 'object',
            required: ['version', 'generatedAt', 'activeWorkspaceId', 'workspaces'],
            properties: {
              version: { const: AGENT_PROTOCOL_VERSION },
              generatedAt: { type: 'integer', minimum: 0 },
              activeWorkspaceId: { type: ['string', 'null'] },
              workspaces: { type: 'array', items: { $ref: '#/$defs/workspaceIdentity' } }
            }
          }
        ]
      }
    },
    'subscribe-agents': {
      kind: 'subscription',
      params: { type: 'object', properties: queryProperties },
      result: {
        type: 'object',
        required: ['subscriptionId', 'version', 'sequence', 'snapshot'],
        properties: {
          subscriptionId: { type: 'integer', minimum: 1 },
          version: { const: AGENT_PROTOCOL_VERSION },
          sequence: { const: 0 },
          snapshot: { type: 'object' }
        }
      },
      event: {
        type: 'object',
        required: [
          'version',
          'sequence',
          'generatedAt',
          'upsert',
          'removed',
          'matched',
          'truncated',
          'summary'
        ],
        properties: {
          version: { const: AGENT_PROTOCOL_VERSION },
          sequence: { type: 'integer', minimum: 1 },
          generatedAt: { type: 'integer', minimum: 0 },
          upsert: { type: 'array', items: { $ref: '#/$defs/agentRecord' } },
          removed: { type: 'array', items: { type: 'string' } },
          matched: { type: 'integer', minimum: 0 },
          truncated: { type: 'boolean' },
          summary: { $ref: '#/$defs/agentSummary' }
        }
      }
    },
    'focus-agent': {
      kind: 'command',
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: stringField(200) }
      },
      result: { $ref: '#/$defs/okResult' }
    },
    'inspect-agent': {
      kind: 'query',
      params: {
        type: 'object',
        required: ['agentId'],
        properties: {
          agentId: stringField(200),
          lines: integerInput(1, MAX_AGENT_INSPECT_LINES, DEFAULT_AGENT_INSPECT_LINES),
          maxBytes: integerInput(1, MAX_AGENT_INSPECT_BYTES, DEFAULT_AGENT_INSPECT_BYTES)
        }
      },
      result: {
        type: 'object',
        required: ['agent', 'terminal'],
        properties: {
          agent: { $ref: '#/$defs/agentRecord' },
          terminal: { $ref: '#/$defs/terminalInspection' }
        }
      }
    },
    'wait-agent': {
      kind: 'query',
      params: {
        type: 'object',
        required: ['agentId', 'state'],
        properties: {
          agentId: stringField(200),
          state: enumListField(AGENT_STATES),
          timeoutMs: integerInput(1, MAX_AGENT_WAIT_TIMEOUT_MS, DEFAULT_AGENT_WAIT_TIMEOUT_MS)
        }
      },
      result: {
        type: 'object',
        required: ['agent'],
        properties: { agent: { $ref: '#/$defs/agentRecord' } }
      }
    },
    'agent-schema': {
      kind: 'query',
      params: { type: 'object' },
      result: { type: 'object' }
    },
    'agent-capabilities': {
      kind: 'query',
      params: {
        type: 'object',
        properties: { provider: { $ref: '#/$defs/agentProvider' } }
      },
      result: { type: 'object' }
    }
  },
  $defs: {
    agentProvider: { type: 'string', enum: AGENT_PROVIDERS },
    agentState: { type: 'string', enum: AGENT_STATES },
    agentActivity: { type: 'string', enum: AGENT_ACTIVITIES },
    agentBlockReason: { type: 'string', enum: AGENT_BLOCK_REASONS },
    agentRecord: {
      type: 'object',
      required: [
        'agentId',
        'provider',
        'displayName',
        'workspaceId',
        'paneId',
        'surfaceId',
        'state',
        'source',
        'revision',
        'updatedAt'
      ],
      properties: {
        agentId: { type: 'string' },
        provider: { $ref: '#/$defs/agentProvider' },
        displayName: { type: 'string' },
        workspaceId: { type: 'string' },
        paneId: { type: 'string' },
        surfaceId: { type: 'string' },
        state: { $ref: '#/$defs/agentState' },
        activity: { $ref: '#/$defs/agentActivity' },
        blockReason: { $ref: '#/$defs/agentBlockReason' },
        message: { type: 'string' },
        source: { type: 'string' },
        sessionId: { type: 'string' },
        revision: { type: 'integer', minimum: 0 },
        updatedAt: { type: 'integer', minimum: 0 },
        staleAt: { type: 'integer', minimum: 0 },
        expiresAt: { type: 'integer', minimum: 0 }
      }
    },
    agentSummary: {
      type: 'object',
      required: ['total', 'actionable', 'byState', 'byProvider'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        actionable: { type: 'integer', minimum: 0 },
        byState: { type: 'object' },
        byProvider: { type: 'object' }
      }
    },
    workspaceIdentity: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'string' }, name: { type: 'string' } }
    },
    terminalInspection: {
      type: 'object',
      required: ['surfaceId', 'pid', 'foreground', 'cwd', 'cols', 'rows', 'createdAt', 'output'],
      properties: {
        surfaceId: { type: 'string' },
        workspaceId: { type: 'string' },
        pid: { type: 'integer', minimum: 1 },
        foreground: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              required: ['pid', 'name'],
              properties: {
                pid: { type: 'integer', minimum: 1 },
                name: { type: 'string' },
                command: { type: 'string' }
              }
            }
          ]
        },
        cwd: { type: 'string' },
        cols: { type: 'integer', minimum: 1 },
        rows: { type: 'integer', minimum: 1 },
        createdAt: { type: 'integer', minimum: 0 },
        output: {
          type: 'object',
          required: ['text', 'lines', 'bytes', 'truncated'],
          properties: {
            text: { type: 'string' },
            lines: { type: 'integer', minimum: 0 },
            bytes: { type: 'integer', minimum: 0, maximum: MAX_AGENT_INSPECT_BYTES },
            truncated: { type: 'boolean' }
          }
        }
      }
    },
    okResult: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { const: true } }
    }
  }
} as const

export interface AgentAdapterCapability {
  provider: AgentProvider
  integration: 'command-hooks' | 'managed-plugin' | 'socket-cli'
  signals: string[]
  sequencing: 'when-supplied' | 'monotonic' | 'optional'
  cleanup: 'stale-expiry' | 'session-end' | 'session-delete' | 'explicit-or-expiry'
}

const ADAPTER_CAPABILITIES: AgentAdapterCapability[] = [
  {
    provider: 'codex',
    integration: 'command-hooks',
    signals: ['session', 'prompt', 'tool', 'approval', 'compaction', 'subagent', 'turn-stop'],
    sequencing: 'when-supplied',
    cleanup: 'stale-expiry'
  },
  {
    provider: 'claude',
    integration: 'command-hooks',
    signals: ['session', 'prompt', 'tool', 'approval', 'notification', 'failure', 'turn-stop'],
    sequencing: 'when-supplied',
    cleanup: 'session-end'
  },
  {
    provider: 'opencode',
    integration: 'managed-plugin',
    signals: ['session', 'tool', 'approval', 'status', 'failure'],
    sequencing: 'monotonic',
    cleanup: 'session-delete'
  },
  {
    provider: 'custom',
    integration: 'socket-cli',
    signals: ['manual-report', 'manual-clear'],
    sequencing: 'optional',
    cleanup: 'explicit-or-expiry'
  }
]

export type AgentCapabilitiesResult =
  { ok: true; capabilities: Record<string, unknown> } | { ok: false; error: string }

export function agentProtocolCapabilities(provider?: unknown): AgentCapabilitiesResult {
  if (
    provider !== undefined &&
    (typeof provider !== 'string' || !AGENT_PROVIDERS.includes(provider as AgentProvider))
  ) {
    return { ok: false, error: `provider must be one of: ${AGENT_PROVIDERS.join(', ')}` }
  }
  const adapters = provider
    ? ADAPTER_CAPABILITIES.filter((adapter) => adapter.provider === provider)
    : ADAPTER_CAPABILITIES
  return {
    ok: true,
    capabilities: {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      methods: AGENT_PROTOCOL_METHODS,
      semantics: {
        providers: AGENT_PROVIDERS,
        states: AGENT_STATES,
        activities: AGENT_ACTIVITIES,
        blockReasons: AGENT_BLOCK_REASONS
      },
      features: {
        producerRevisions: true,
        staleTransition: true,
        expiry: true,
        exactFocus: true,
        boundedTerminalInspection: true,
        semanticWait: true,
        boundedQueries: true,
        reconnectSnapshot: true,
        eventSubscriptions: true,
        automaticProcessDiscovery: true
      },
      limits: {
        maxLifecycleMs: MAX_AGENT_LIFECYCLE_MS,
        defaultQueryLimit: DEFAULT_AGENT_QUERY_LIMIT,
        maxQueryLimit: MAX_AGENT_QUERY_LIMIT,
        defaultInspectLines: DEFAULT_AGENT_INSPECT_LINES,
        maxInspectLines: MAX_AGENT_INSPECT_LINES,
        defaultInspectBytes: DEFAULT_AGENT_INSPECT_BYTES,
        maxInspectBytes: MAX_AGENT_INSPECT_BYTES,
        maxTerminalCaptureBytes: MAX_TERMINAL_CAPTURE_BYTES,
        defaultWaitTimeoutMs: DEFAULT_AGENT_WAIT_TIMEOUT_MS,
        maxWaitTimeoutMs: MAX_AGENT_WAIT_TIMEOUT_MS
      },
      adapters
    }
  }
}
