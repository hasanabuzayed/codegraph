/**
 * Server-level instructions emitted in the MCP initialize response.
 *
 * MCP clients (Claude Code, Cursor, opencode, LangChain, OpenAI Agent SDK)
 * show this text in the system prompt of the agent. This text gives the
 * agent a playbook for codegraph before the agent reads individual tool
 * descriptions.
 *
 * Goals when you edit this:
 *   - Lead the agent to codegraph_explore for any structural or flow question.
 *   - Reinforce "explore instead of Read/Grep" for indexed code.
 *   - State anti-patterns (do not re-verify with grep. Do not hand-reconstruct flows).
 *
 * Keep the text concise. The agent reads this text in every session.
 * The default MCP surface is codegraph_explore alone (see DEFAULT_MCP_TOOLS
 * in tools.ts). Reference only that tool here. Other tools stay defined and
 * activate through CODEGRAPH_MCP_TOOLS. Because the server does not list
 * those tools to agents, do not name them here.
 */
export const SERVER_INSTRUCTIONS = `# Codegraph — code intelligence over an indexed knowledge graph

Codegraph is a SQLite knowledge graph of every symbol, edge, and file in the workspace. This pre-computed structure prevents work you would otherwise repeat by reading files. The cached intelligence stores thousands of parse/trace decisions. Do not calculate them again on each run.

It indexes 30+ languages (TypeScript/JavaScript, Python, Go, Rust, Java, C#, C/C++, PHP, Ruby, Swift, Kotlin, and more). Assume that the index covers these languages. Read operations are sub-millisecond. Through the file watcher, the index lags writes by ~1s.

Use codegraph BEFORE and while writing or editing code, not just for questions. One call returns the verbatim source, the callers, and what it affects. You edit with the blast radius in view. This call gives more accurate context in fewer tokens and round-trips than reading files yourself.

## One tool: codegraph_explore — use it instead of reading files

There is a single tool, \`codegraph_explore\`. It provides the same data as the Read tool. It takes either a natural-language question or a bag of symbol/file names. It returns the **verbatim, line-numbered source** of the relevant symbols grouped by file.

The output matches the \`<n>\\t<line>\` shape from \`Read\`, safe to \`Edit\` from. It also includes call paths between symbols, dynamic-dispatch hops (callbacks, React re-render, and JSX children where grep can fail), and a blast-radius summary.

Whether answering "how does X work" or changing code, call \`codegraph_explore\` before you Read. ONE call usually answers the whole question.

Codegraph is the pre-built search index. A manual grep and read loop, or delegating lookup to a sub-task/agent, repeats existing work. That approach costs more for the same answer. A direct codegraph answer takes one or a few calls, while a grep/read loop takes dozens.

## How to query

- **Almost any question: "how does X work", architecture, a bug, "what/where is X", or an area survey** → Query \`codegraph_explore\` with a question or names. ONE capped call returns verbatim source grouped by file. Most often this is the ONLY call you need.
- **"How does X reach/become Y? / the flow / the path from X to Y"** → Query \`codegraph_explore\` and name the symbols that span the flow (for example, \`mutateElement renderScene\`). The tool surfaces the call path across dynamic-dispatch hops and returns the source.
- **Reading or editing a file/symbol you can name** → Put its name or file path in the \`codegraph_explore\` query. It returns current line-numbered source (safe to \`Edit\` from) with the call path and blast radius attached. That avoids a separate Read. For an overloaded name, it returns every matching definition body in one call.
- **Need more?** Call \`codegraph_explore\` again with more specific names. Treat the returned source as already Read. Suggested call counts are advisory only, NOT a quota. The server never rejects or rate-limits extra calls.
- Qualified symbol names accept dots, \`::\`, or slashes, including containers whose names contain dots (for example, \`AppWeb.Format.group\`).
- Named-symbol call paths need exact matches. The server never silently substitutes partial or mistyped names as flow endpoints. If a graph query reports a missing symbol with did-you-mean suggestions, query the suggested name explicitly.
- Explore matches names and indexed code words lexically, not by meaning. An empty result reports word matches and may suggest indexed candidate names to retry with \`codegraph_explore\`.

## Anti-patterns

- **Trust codegraph results — avoid grep re-verification.** Results come from a full AST parse. Re-checking with grep is slower, less accurate, and wastes context.
- **Avoid initial grep or Read** for finding or understanding indexed code. ONE \`codegraph_explore\` call returns the relevant source in a single round-trip. Reach for raw \`Read\`/\`Grep\` only to confirm details omitted by codegraph, or for unindexed files (configs, docs).
- **Avoid manual flow reconstruction.** Name the endpoints in one \`codegraph_explore\` call. The tool surfaces the path between them, including dynamic-dispatch hops.
- **After editing, inspect the staleness banner.**
  When a response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files await re-indexing. Read those specific files for accurate content. Every file NOT in that banner is fresh, so still trust codegraph.

  A different, rarer banner — "⚠️ CodeGraph auto-sync is DISABLED…" or "⚠️ CodeGraph auto-sync is RECOVERING…" — means the whole index may be stale. Until catch-up completes, Read files directly to confirm anything that possibly changed. If a response refuses or freshness could not be verified within budget, retry after sync or narrow the query. That refusal is not an error in the tool.
- **A file flagged "⚠ changed on disk after the last index sync" drifted from its index** (common with \`projectPath\` queries without a live watcher). Codegraph never serves a possibly-mis-sliced body from such a file. It either shows the full CURRENT source (trust it as a Read) or omits the source with this flag. When the source was omitted, Read that specific file. Line numbers referencing it elsewhere in the response may shift until that project next sync. All unflagged files remain trustworthy.

- **Source is re-served on every call by default**, including for fresh subagents and after context compaction. Cross-call dedup needs \`CODEGRAPH_EXPLORE_DEDUP=1\` and is only suitable for hosts that guarantee one durable context per connection. With that opt-in, **"Already sent earlier in this conversation"** points to exact source from an earlier \`codegraph_explore\` in that context. Use that copy. Avoid re-fetching or reading the file. The freed bytes went into source you have not seen yet, elsewhere in the same response.

## Limitations

- If a tool reports an unindexed project (no \`.codegraph/\`), stop calling codegraph tools for that project for the rest of the session. Use your built-in tools there instead. Indexing is the decision of the user. Mention they can run \`codegraph init\` if it comes up. Leave indexing to the user.
- The index lags file writes by ~1 second.
- Cross-file resolution is best-effort name matching. Ambiguous calls may return multiple candidates.
- There is No live correctness validation. That remains the job of the TypeScript compiler, test suite, and linter. Codegraph supplements those with structural context missing from them.
`;

/**
 * Instruction variant sent when the server root has no codegraph index.
 *
 * The server still exposes the tools. This variant informs the agent that
 * codegraph operates per project. There is no default project to query.
 * Pass a projectPath to any project that has a .codegraph/ index. The server
 * sends the full single-project playbook (SERVER_INSTRUCTIONS) when the root
 * has an index.
 */
export const SERVER_INSTRUCTIONS_NO_ROOT_INDEX = `# Codegraph — available (per-project; pass projectPath)

Codegraph is a SQLite knowledge graph of symbols, edges, and files in 30+ languages. One \`codegraph_explore\` call returns the verbatim, line-numbered source of relevant symbols. It also returns the call paths between them and a blast-radius summary. This single round-trip replaces a grep + Read loop.

This server started somewhere with no \`.codegraph/\` of its own, so there is no default project. The tools remain available and work per project:

- To query a project with a \`.codegraph/\` index, pass its path as \`projectPath\` to \`codegraph_explore\`. The option also applies to any other codegraph tool. For example, query a service inside a monorepo or a second repository. Codegraph resolves the nearest \`.codegraph/\` at or above that path and answers from it. Codegraph supports multiple projects in one session.
- For a project with no \`.codegraph/\`, use your built-in tools (Read/Grep/Glob). Indexing is the decision of the user. Leave indexing to the user. If needed, the user can run \`codegraph init\` in a project to enable codegraph there. The server detects a new index live, with no restart.
`;
