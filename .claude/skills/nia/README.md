# Nia Skill

AI agent skill for [Nia](https://trynia.ai) - index and search code repositories, documentation, research papers, HuggingFace datasets, local folders, Slack workspaces, and packages.

## What is Nia?

Nia provides tools for indexing and searching external repositories, research papers, documentation, packages, local folders, Slack workspaces, and performing AI-powered research. Its primary goal is to reduce hallucinations in LLMs and provide up-to-date context for AI agents.

## Setup

1. Get your API key:
   - Run `npx nia-wizard@latest` (guided setup)
   - Or sign up at [trynia.ai](https://trynia.ai)

2. Store the key:

   Set the `NIA_API_KEY` environment variable:
   ```bash
   export NIA_API_KEY="your-api-key"
   ```

   Or use a config file:
   ```bash
   mkdir -p ~/.config/nia
   echo "your-api-key" > ~/.config/nia/api_key
   ```

   > `NIA_API_KEY` takes precedence over the config file.

3. Requirements: `curl`, `jq`

## Usage

```bash
# Index a repository
./scripts/repos.sh index "owner/repo"

# List indexed repositories
./scripts/repos.sh list

# Search all indexed sources
./scripts/search.sh universal "how does auth work?"

# Index documentation
./scripts/sources.sh index "https://docs.stripe.com"

# Grep repository code
./scripts/repos.sh grep "vercel/ai" "streamText"

# Connect Slack workspace
./scripts/slack.sh register-token xoxb-your-token "My Workspace"

# Search Slack messages
SLACK_WORKSPACES=<id> ./scripts/search.sh query "question"
```

## Scripts

All scripts are in `./scripts/` and use subcommands: `./scripts/<script>.sh <command> [args...]`

| Script | Description |
|--------|-------------|
| `repos.sh` | Index, list, read, grep, tree for GitHub repositories |
| `sources.sh` | Index, list, read, grep, tree for documentation and data sources |
| `search.sh` | Query specific sources, universal search, web search, deep research |
| `oracle.sh` | Autonomous Oracle research agent (Pro) |
| `tracer.sh` | Live GitHub code search without indexing (Pro) |
| `slack.sh` | Slack workspace integration (OAuth, BYOT, channels, grep, messages) |
| `papers.sh` | Index and list arXiv research papers |
| `datasets.sh` | Index and list HuggingFace datasets |
| `packages.sh` | Grep and search package source code (npm, PyPI, crates.io, Go) |
| `folders.sh` | Local folder management (private storage) |
| `categories.sh` | Organize sources into categories |
| `contexts.sh` | Cross-agent context sharing |
| `deps.sh` | Dependency analysis and doc subscription |
| `advisor.sh` | AI code advisor grounded in indexed sources |
| `github.sh` | Live GitHub API search (glob, read, search, tree) |
| `usage.sh` | API usage summary |

## Documentation

See [SKILL.md](./SKILL.md) for detailed usage, environment variables, and the Nia-first workflow guide.

## License

MIT
