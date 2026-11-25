// MCP connectors: one-click remote MCP servers (OAuth in the browser), shared with every agent.
// Agents never see a token. Each connection is served on a loopback proxy that adds the token and refreshes it,
// so a long-running agent keeps working after the provider's access token expires.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// auth: oauth (browser sign-in, dynamic client registration), none (public), token (paste a key),
// local (a stdio server Dispatch starts with npx). Every oauth entry was checked for registration support.
const CATALOG = Object.freeze([
  { id: 'notion', name: 'Notion', group: 'work', desc: 'Search, read and write pages and databases in your workspace.', url: 'https://mcp.notion.com/mcp', auth: 'oauth' },
  { id: 'linear', name: 'Linear', group: 'work', desc: 'Find, create and update issues, projects and comments.', url: 'https://mcp.linear.app/mcp', auth: 'oauth' },
  { id: 'atlassian', name: 'Jira and Confluence', icon: 'atlassian', group: 'work', desc: 'Work with Jira issues and Confluence pages.', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth' },
  { id: 'clickup', name: 'ClickUp', group: 'work', desc: 'Tasks, docs and comments in your ClickUp spaces.', url: 'https://mcp.clickup.com/mcp', auth: 'oauth' },
  { id: 'monday', name: 'monday.com', group: 'work', desc: 'Boards, items and updates in monday.com.', url: 'https://mcp.monday.com/mcp', auth: 'oauth' },
  { id: 'airtable', name: 'Airtable', group: 'work', desc: 'Read and edit bases, tables and records.', url: 'https://mcp.airtable.com/mcp', auth: 'oauth' },
  { id: 'granola', name: 'Granola', domain: 'granola.ai', group: 'work', desc: 'Your meeting notes and transcripts.', url: 'https://mcp.granola.ai/mcp', auth: 'oauth' },
  { id: 'intercom', name: 'Intercom', group: 'work', desc: 'Search conversations, tickets and contacts.', url: 'https://mcp.intercom.com/mcp', auth: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', group: 'work', desc: 'Search, read and manage files and folders in Dropbox.', url: 'https://mcp.dropbox.com/mcp', auth: 'oauth' },
  { id: 'todoist', name: 'Todoist', group: 'work', desc: 'Tasks, projects, sections and labels in Todoist.', url: 'https://ai.todoist.net/mcp', auth: 'oauth' },
  { id: 'calcom', name: 'Cal.com', group: 'work', desc: 'Bookings, availability and event types.', url: 'https://mcp.cal.com/mcp', auth: 'oauth' },
  { id: 'shortcut', name: 'Shortcut', group: 'work', desc: 'Stories, epics, iterations and workflows in Shortcut.', url: 'https://mcp.shortcut.com/mcp', auth: 'oauth' },
  { id: 'gitbook', name: 'GitBook', group: 'work', desc: 'Search and read spaces and docs in GitBook.', url: 'https://mcp.gitbook.com/mcp', auth: 'oauth' },
  { id: 'jotform', name: 'Jotform', domain: 'jotform.com', group: 'work', desc: 'Forms, submissions and responses in Jotform.', url: 'https://mcp.jotform.com/mcp', auth: 'oauth' },
  { id: 'github', name: 'GitHub', group: 'build', desc: 'Repositories, issues, pull requests and Actions.', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', tokenHelp: 'A personal access token from github.com/settings/tokens', tokenUrl: 'https://github.com/settings/personal-access-tokens/new' },
  { id: 'vercel', name: 'Vercel', group: 'build', desc: 'Projects, deployments and their logs.', url: 'https://mcp.vercel.com', auth: 'oauth' },
  { id: 'netlify', name: 'Netlify', group: 'build', desc: 'Sites, deploys, environment variables and functions.', url: 'https://netlify-mcp.netlify.app/mcp', auth: 'oauth' },
  { id: 'railway', name: 'Railway', group: 'build', desc: 'Services, deployments, variables and logs.', url: 'https://mcp.railway.com/mcp', auth: 'oauth' },
  { id: 'digitalocean', name: 'DigitalOcean', group: 'build', desc: 'Droplets, apps, databases and spaces in DigitalOcean.', url: 'https://mcp.digitalocean.com/mcp', auth: 'oauth' },
  { id: 'upstash', name: 'Upstash', group: 'build', desc: 'Serverless Redis, QStash and Vector databases.', url: 'https://mcp.upstash.com/mcp', auth: 'oauth' },
  { id: 'convex', name: 'Convex', group: 'build', desc: 'Convex backend docs and project scaffolding.', url: 'https://mcp.convex.dev/mcp', auth: 'none' },
  { id: 'clerk', name: 'Clerk', group: 'build', desc: 'Users, organizations and authentication in Clerk.', url: 'https://mcp.clerk.com/mcp', auth: 'oauth' },
  { id: 'workos', name: 'WorkOS', group: 'build', desc: 'Enterprise SSO, directory sync and organizations.', url: 'https://mcp.workos.com/mcp', auth: 'oauth' },
  { id: 'launchdarkly', name: 'LaunchDarkly', domain: 'launchdarkly.com', group: 'build', desc: 'Feature flags, environments and experiments.', url: 'https://mcp.launchdarkly.com/mcp', auth: 'oauth' },
  { id: 'incidentio', name: 'incident.io', domain: 'incident.io', group: 'build', desc: 'Incidents, alerts, on-call schedules and postmortems.', url: 'https://mcp.incident.io/mcp', auth: 'oauth' },
  { id: 'mintlify', name: 'Mintlify', group: 'build', desc: 'Search and manage Mintlify documentation.', url: 'https://mcp.mintlify.com/mcp', auth: 'oauth' },
  { id: 'supabase', name: 'Supabase', group: 'build', desc: 'Databases, tables, SQL, edge functions and logs.', url: 'https://mcp.supabase.com/mcp', auth: 'oauth' },
  { id: 'neon', name: 'Neon', group: 'build', desc: 'Serverless Postgres projects, branches and queries.', url: 'https://mcp.neon.tech/mcp', auth: 'oauth' },
  { id: 'prisma', name: 'Prisma Postgres', icon: 'prisma', group: 'build', desc: 'Create and manage Prisma Postgres databases.', url: 'https://mcp.prisma.io/mcp', auth: 'oauth' },
  { id: 'sentry', name: 'Sentry', group: 'build', desc: 'Errors, issues and performance data from your projects.', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth' },
  { id: 'semgrep', name: 'Semgrep', domain: 'semgrep.dev', group: 'build', desc: 'Code security scans, findings and rules.', url: 'https://mcp.semgrep.ai/mcp', auth: 'oauth' },
  { id: 'buildkite', name: 'Buildkite', group: 'build', desc: 'Pipelines, builds, jobs and logs.', url: 'https://mcp.buildkite.com/mcp', auth: 'oauth' },
  { id: 'cloudflare', name: 'Cloudflare', group: 'build', desc: 'Workers, KV, R2 and D1 in your account.', url: 'https://bindings.mcp.cloudflare.com/mcp', auth: 'oauth' },
  { id: 'resend', name: 'Resend', group: 'build', desc: 'Send emails and inspect domains and audiences.', url: 'https://mcp.resend.com/mcp', auth: 'oauth' },
  { id: 'postman', name: 'Postman', group: 'build', desc: 'Workspaces, collections and API environments.', url: 'https://mcp.postman.com/mcp', auth: 'oauth' },
  { id: 'context7', name: 'Context7', domain: 'context7.com', group: 'build', desc: 'Up-to-date docs and code examples for any library.', url: 'https://mcp.context7.com/mcp', auth: 'none' },
  { id: 'deepwiki', name: 'DeepWiki', domain: 'deepwiki.com', group: 'build', desc: 'Ask questions about any public GitHub repository.', url: 'https://mcp.deepwiki.com/mcp', auth: 'none' },
  { id: 'huggingface', name: 'Hugging Face', group: 'build', desc: 'Search models, datasets, papers and Spaces.', url: 'https://huggingface.co/mcp', auth: 'none' },
  { id: 'exa', name: 'Exa', group: 'build', desc: 'Web search and page contents for agents.', url: 'https://mcp.exa.ai/mcp', auth: 'none' },
  { id: 'tavily', name: 'Tavily', domain: 'tavily.com', group: 'build', desc: 'Real-time web search and content extraction.', url: 'https://mcp.tavily.com/mcp', auth: 'oauth' },
  { id: 'firecrawl', name: 'Firecrawl', group: 'build', desc: 'Scrape, crawl and extract structured web data.', url: 'https://mcp.firecrawl.dev/mcp', auth: 'none' },
  { id: 'apify', name: 'Apify', group: 'build', desc: 'Run Apify Actors and web scraping workflows.', url: 'https://mcp.apify.com', auth: 'oauth' },
  { id: 'jina', name: 'Jina', domain: 'jina.ai', group: 'build', desc: 'Read web pages, search and ground facts.', url: 'https://mcp.jina.ai/v1', auth: 'none' },
  { id: 'browserbase', name: 'Browserbase', group: 'build', desc: 'Cloud headless browser sessions for agents.', url: 'https://mcp.browserbase.com/mcp', auth: 'none' },
  { id: 'chrome-devtools', name: 'Chrome DevTools', icon: 'googlechrome', group: 'build', desc: 'Drive and debug a real Chrome: console, network, performance.', auth: 'local', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
  { id: 'playwright', name: 'Playwright', group: 'build', desc: 'Browse, click and test web pages in a real browser.', auth: 'local', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  { id: 'canva', name: 'Canva', domain: 'canva.com', group: 'design', desc: 'Create, edit, resize and export Canva designs.', url: 'https://mcp.canva.com/mcp', auth: 'oauth' },
  { id: 'gamma', name: 'Gamma', domain: 'gamma.app', group: 'design', desc: 'Create and edit presentations, docs and webpages.', url: 'https://mcp.gamma.app/mcp', auth: 'oauth' },
  { id: 'figma', name: 'Figma', group: 'design', desc: 'Designs from the Figma desktop app (turn on its MCP server in Dev Mode).', url: 'http://127.0.0.1:3845/mcp', auth: 'none', hint: 'Figma has no browser sign-in here: open the Figma desktop app, open a design file, switch to Dev Mode and turn on "Enable desktop MCP server" in the Inspect panel (or Figma menu > Preferences), then try again.' },
  { id: 'framer', name: 'Framer', group: 'design', desc: 'Sites, CMS collections and pages in Framer.', url: 'https://mcp.framer.com/mcp', auth: 'oauth' },
  { id: 'miro', name: 'Miro', group: 'design', desc: 'Boards, sticky notes, diagrams and frames.', url: 'https://mcp.miro.com/', auth: 'oauth' },
  { id: 'webflow', name: 'Webflow', group: 'design', desc: 'Sites, CMS collections and pages.', url: 'https://mcp.webflow.com/mcp', auth: 'oauth' },
  { id: 'wix', name: 'Wix', group: 'design', desc: 'Build and manage Wix sites and their content.', url: 'https://mcp.wix.com/mcp', auth: 'oauth' },
  { id: 'contentful', name: 'Contentful', group: 'design', desc: 'Content types, entries and assets in Contentful.', url: 'https://mcp.contentful.com/mcp', auth: 'oauth' },
  { id: 'sanity', name: 'Sanity', group: 'design', desc: 'Schemas, documents and GROQ queries in Sanity.', url: 'https://mcp.sanity.io', auth: 'oauth' },
  { id: 'grafana', name: 'Grafana', group: 'data', desc: 'Dashboards, alerts, Prometheus and Loki queries.', url: 'https://mcp.grafana.com/mcp', auth: 'oauth' },
  { id: 'axiom', name: 'Axiom', domain: 'axiom.co', group: 'data', desc: 'Datasets, APL queries and log streams.', url: 'https://mcp.axiom.co/mcp', auth: 'oauth' },
  { id: 'datadog', name: 'Datadog', group: 'data', desc: 'Logs, metrics, monitors and traces.', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp', auth: 'oauth' },
  { id: 'honeycomb', name: 'Honeycomb', domain: 'honeycomb.io', group: 'data', desc: 'Traces, datasets, queries and SLOs in Honeycomb.', url: 'https://mcp.honeycomb.io/mcp', auth: 'oauth' },
  { id: 'hex', name: 'Hex', domain: 'hex.tech', group: 'data', desc: 'Notebooks, data projects and SQL/Python runs in Hex.', url: 'https://app.hex.tech/mcp', auth: 'oauth' },
  { id: 'amplitude', name: 'Amplitude', domain: 'amplitude.com', group: 'data', desc: 'Charts, cohorts, events and product metrics.', url: 'https://mcp.amplitude.com/mcp', auth: 'oauth' },
  { id: 'mixpanel', name: 'Mixpanel', group: 'data', desc: 'Events, funnels, retention and user cohorts.', url: 'https://mcp.mixpanel.com/mcp', auth: 'oauth' },
  { id: 'posthog', name: 'PostHog', group: 'data', desc: 'Product analytics, feature flags and session insights.', url: 'https://mcp.posthog.com/mcp', auth: 'oauth' },
  { id: 'spline', name: 'Spline', domain: 'spline.design', group: 'media', desc: '3D scenes, objects, materials and exports in Spline.', url: 'https://mcp.spline.design/mcp', auth: 'oauth' },
  { id: 'runway', name: 'Runway', domain: 'runwayml.com', group: 'media', desc: 'Generate and edit AI video and images in Runway.', url: 'https://mcp.runwayml.com/mcp', auth: 'oauth' },
  { id: 'higgsfield', name: 'Higgsfield', domain: 'higgsfield.ai', group: 'media', desc: 'Generate images and videos with Higgsfield models.', url: 'https://mcp.higgsfield.ai/mcp', auth: 'oauth' },
  { id: 'pika', name: 'Pika', domain: 'pika.art', group: 'media', desc: 'Create characters, animations and video clips in Pika.', url: 'https://mcp.pika.art/mcp', auth: 'none' },
  { id: 'vimeo', name: 'Vimeo', group: 'media', desc: 'Videos, folders, transcripts and analytics in Vimeo.', url: 'https://mcp.vimeo.com/mcp', auth: 'oauth' },
  { id: 'mux', name: 'Mux', domain: 'mux.com', group: 'media', desc: 'Video assets, live streams and playback metrics in Mux.', url: 'https://mcp.mux.com/mcp', auth: 'oauth' },
  { id: 'cloudinary', name: 'Cloudinary', group: 'media', desc: 'Upload, transform and organize images and video.', url: 'https://asset-management.mcp.cloudinary.com/mcp', auth: 'oauth' },
  { id: 'heygen', name: 'HeyGen', domain: 'heygen.com', group: 'media', desc: 'AI avatar videos, voices and translations in HeyGen.', url: 'https://mcp.heygen.com/mcp', auth: 'oauth' },
  { id: 'synthesia', name: 'Synthesia', domain: 'synthesia.io', group: 'media', desc: 'Create and manage AI presenter videos in Synthesia.', url: 'https://mcp.synthesia.io/mcp', auth: 'oauth' },
  { id: 'beehiiv', name: 'beehiiv', domain: 'beehiiv.com', group: 'media', desc: 'Newsletters, posts, subscribers and publications.', url: 'https://mcp.beehiiv.com/mcp', auth: 'oauth' },
  { id: 'pubmed', name: 'PubMed', domain: 'pubmed.ncbi.nlm.nih.gov', group: 'science', desc: 'Biomedical articles: search, details, related work and free full text.', url: 'https://pubmed.mcp.claude.com/mcp', auth: 'none' },
  { id: 'openalex', name: 'OpenAlex', domain: 'openalex.org', group: 'science', desc: 'Open catalogue of papers, authors, institutions and citations in every field.', url: 'https://mcp.openalex.org/mcp', auth: 'oauth' },
  { id: 'alphaxiv', name: 'alphaXiv', domain: 'alphaxiv.org', group: 'science', desc: 'arXiv papers: search, summaries and full text.', url: 'https://api.alphaxiv.org/mcp/v1', auth: 'oauth' },
  { id: 'consensus', name: 'Consensus', domain: 'consensus.app', group: 'science', desc: 'Answers from peer-reviewed research, with the papers behind them.', url: 'https://mcp.consensus.app/mcp', auth: 'oauth' },
  { id: 'scite', name: 'Scite', domain: 'scite.ai', group: 'science', desc: 'How a paper is cited: supported, contrasted or mentioned.', url: 'https://api.scite.ai/mcp', auth: 'oauth' },
  { id: 'scholargateway', name: 'Scholar Gateway', domain: 'scholargateway.ai', group: 'science', desc: 'Peer-reviewed literature from Wiley, with citations.', url: 'https://connector.scholargateway.ai/mcp', auth: 'oauth' },
  { id: 'opentargets', name: 'Open Targets', domain: 'platform.opentargets.org', group: 'science', desc: 'Drug targets, diseases, drugs and the evidence between them.', url: 'https://mcp.platform.opentargets.org/mcp', auth: 'none' },
  { id: 'synapse', name: 'Synapse', domain: 'synapse.org', group: 'science', desc: 'Open biomedical datasets from Sage Bionetworks.', url: 'https://mcp.synapse.org/mcp', auth: 'oauth' },
  { id: 'biorender', name: 'BioRender', domain: 'biorender.com', group: 'science', desc: 'Scientific icons and figure templates.', url: 'https://mcp.services.biorender.com/mcp', auth: 'oauth' },
  { id: 'kiwi', name: 'Kiwi.com', domain: 'kiwi.com', group: 'life', desc: 'Search flights, routes and fares on Kiwi.com.', url: 'https://mcp.kiwi.com', auth: 'none' },
  { id: 'strava', name: 'Strava', group: 'life', desc: 'Activities, routes, clubs and training stats.', url: 'https://mcp.strava.com/mcp', auth: 'oauth' },
  { id: 'mapbox', name: 'Mapbox', group: 'life', desc: 'Geocoding, directions, isochrones and map styles.', url: 'https://mcp.mapbox.com/mcp', auth: 'oauth' },
  { id: 'openweather', name: 'OpenWeather', domain: 'openweathermap.org', group: 'life', desc: 'Current weather, forecasts and climate data.', url: 'https://mcp.openweathermap.org/mcp', auth: 'none' },
  { id: 'stripe', name: 'Stripe', group: 'business', desc: 'Customers, payments, invoices and products.', url: 'https://mcp.stripe.com', auth: 'oauth' },
  { id: 'paypal', name: 'PayPal', group: 'business', desc: 'Invoices, orders, subscriptions and disputes.', url: 'https://mcp.paypal.com/mcp', auth: 'oauth' },
  { id: 'square', name: 'Square', group: 'business', desc: 'Payments, orders, catalog and customers.', url: 'https://mcp.squareup.com/mcp', auth: 'oauth' },
  { id: 'mercadopago', name: 'Mercado Pago', group: 'business', desc: 'Payments, orders, subscriptions and refunds.', url: 'https://mcp.mercadopago.com/mcp', auth: 'oauth' },
  { id: 'paddle', name: 'Paddle', group: 'business', desc: 'Subscriptions, products, prices and transactions.', url: 'https://mcp.paddle.com/mcp', auth: 'oauth' },
  { id: 'shopify', name: 'Shopify Catalog', group: 'business', desc: 'Search products across Shopify stores.', url: 'https://catalog.shopify.com/api/ucp/mcp', auth: 'none' },
  { id: 'buffer', name: 'Buffer', group: 'business', desc: 'Schedule posts and manage social channels in Buffer.', url: 'https://mcp.buffer.com/mcp', auth: 'oauth' },
  { id: 'hootsuite', name: 'Hootsuite', group: 'business', desc: 'Social posts, streams and engagement in Hootsuite.', url: 'https://mcp.hootsuite.com/mcp', auth: 'oauth' },
  { id: 'klaviyo', name: 'Klaviyo', domain: 'klaviyo.com', group: 'business', desc: 'Campaigns, flows, profiles and segments in Klaviyo.', url: 'https://mcp.klaviyo.com/mcp', auth: 'oauth' },
  { id: 'kit', name: 'Kit', domain: 'kit.com', group: 'business', desc: 'Subscribers, tags, sequences and broadcasts in Kit (ConvertKit).', url: 'https://app.kit.com/mcp', auth: 'oauth' },
  { id: 'producthunt', name: 'Product Hunt', domain: 'producthunt.com', group: 'launch', desc: 'Discover launches, prepare your own launch and read its results.', url: 'https://mcp.producthunt.com/mcp', auth: 'oauth' },
  { id: 'uneed', name: 'Uneed', domain: 'uneed.best', group: 'launch', desc: 'Curated tool directory: products, launches, reviews, deals and alternatives.', url: 'https://mcp.uneed.best/mcp', auth: 'none' },
  { id: 'microlaunch', name: 'MicroLaunch', domain: 'microlaunch.net', group: 'launch', desc: 'Indie maker launches: top launches, categories, products and deals.', url: 'https://mcp.microlaunch.net/mcp', auth: 'none' },
  { id: 'taaft', name: "There's An AI For That", domain: 'theresanaiforthat.com', group: 'launch', desc: 'AI tools, models, tasks, papers and news from the AI directory.', url: 'https://theresanaiforthat.com/mcp/', auth: 'none' },
  { id: 'mailchimp', name: 'Mailchimp', group: 'business', desc: 'Audiences, campaigns and templates in Mailchimp.', url: 'https://mcp.mailchimp.com/mcp', auth: 'oauth' },
  { id: 'alpaca', name: 'Alpaca', domain: 'alpaca.markets', group: 'business', desc: 'Stock and crypto market data and assets.', url: 'https://mcp.alpaca.markets/mcp', auth: 'none' },
  { id: 'coingecko', name: 'CoinGecko', domain: 'coingecko.com', group: 'business', desc: 'Crypto prices, market caps, coins and trends.', url: 'https://mcp.api.coingecko.com/mcp', auth: 'none' },
  { id: 'alphavantage', name: 'Alpha Vantage', domain: 'alphavantage.co', group: 'business', desc: 'Stock quotes, forex, crypto and financial indicators.', url: 'https://mcp.alphavantage.co/mcp', auth: 'oauth' },
  { id: 'mercury', name: 'Mercury', domain: 'mercury.com', group: 'business', desc: 'Accounts, balances and transactions in Mercury.', url: 'https://mcp.mercury.com/mcp', auth: 'oauth' },
  { id: 'ramp', name: 'Ramp', domain: 'ramp.com', group: 'business', desc: 'Expenses, cards, reimbursements and vendors.', url: 'https://mcp.ramp.com/mcp', auth: 'oauth' },
  { id: 'zapier', name: 'Zapier', group: 'business', desc: 'Run actions in thousands of apps you set up in Zapier.', url: 'https://mcp.zapier.com/api/mcp/mcp', auth: 'oauth' },
]);
const GROUPS = Object.freeze([
  { id: 'work', name: 'Work and docs', desc: 'Notes, tasks and tickets your team already keeps.' },
  { id: 'build', name: 'Build and ship', desc: 'Code, databases, deployments, docs and the browser.' },
  { id: 'design', name: 'Design and sites', desc: 'Design files and website builders.' },
  { id: 'data', name: 'Data and analytics', desc: 'Logs, metrics, product analytics and dashboards.' },
  { id: 'media', name: 'Media and creative', desc: 'Video, 3D, images, audio and publishing.' },
  { id: 'science', name: 'Science and research', desc: 'Papers, citations and open research data.' },
  { id: 'life', name: 'Lifestyle and everyday', desc: 'Travel, fitness, maps and weather.' },
  { id: 'business', name: 'Payments, marketing and finance', desc: 'Commerce, social, banking and workflows across apps.' },
  { id: 'launch', name: 'Product launch', desc: 'Launch directories and maker communities: research, prepare and follow a launch.' },
]);

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'mcp';
const timeout = (ms = 15000) => AbortSignal.timeout(ms);
async function getJson(url) { try { const r = await fetch(url, { headers: { accept: 'application/json' }, signal: timeout() }); return r.ok ? await r.json() : null; } catch { return null; } }
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Dispatch', version: '1' } } };

/** Reads a JSON-RPC reply from a plain JSON or SSE response. */
async function readRpc(r, id) {
  const text = await r.text();
  if (!/event-stream/.test(r.headers.get('content-type') || '')) { try { return JSON.parse(text); } catch { return null; } }
  for (const line of text.split(/\r?\n/)) if (line.startsWith('data:')) { try { const m = JSON.parse(line.slice(5)); if (m.id === id) return m; } catch {} }
  return null;
}

/** Where to sign in: the protected resource metadata (MCP 2025-06) or, for older servers, the server's own origin. */
async function discover(url, wantAuth = false) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(INIT), signal: timeout() }); }
  catch (e) { throw new Error(`Could not reach ${new URL(url).host}: ${e.cause?.code || e.message}`); }
  // Some servers (Product Hunt) greet anyone and ask for the sign-in only when a tool is used.
  if (r.status !== 401 && r.status !== 403 && !(wantAuth && r.ok)) { try { await r.body?.cancel(); } catch {} if (r.ok) return { auth: 'none' }; throw new Error(`${new URL(url).host} answered ${r.status}. Check the address.`); }
  if (r.ok) try { await r.body?.cancel(); } catch {}
  const www = r.headers.get('www-authenticate') || '';
  const u = new URL(url);
  const m = /resource_metadata="([^"]+)"/.exec(www);
  const prm = (m && await getJson(m[1])) || await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname === '/' ? '' : u.pathname}`) || await getJson(`${u.origin}/.well-known/oauth-protected-resource`);
  const issuer = prm?.authorization_servers?.[0] || u.origin;
  const a = new URL(issuer); const p = a.pathname.replace(/\/$/, '');
  const meta = await getJson(`${a.origin}/.well-known/oauth-authorization-server${p}`) || await getJson(`${a.origin}/.well-known/openid-configuration${p}`) || (p && await getJson(`${a.origin}${p}/.well-known/openid-configuration`)) || (p && await getJson(`${a.origin}/.well-known/oauth-authorization-server`));
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) throw new Error(`${u.host} needs a sign-in Dispatch cannot start (no OAuth metadata). Use a token instead.`);
  if (!meta.registration_endpoint) throw new Error(`${u.host} only signs in apps it approved in advance, so Dispatch cannot connect to it by itself.`);
  let scope = /scope="([^"]+)"/.exec(www)?.[1] || (prm?.scopes_supported || []).join(' ');
  // Servers that know offline_access give a refresh token only to those who ask for it.
  if ((meta.scopes_supported || []).includes('offline_access') && !scope.split(' ').includes('offline_access')) scope = `${scope} offline_access`.trim();
  return { auth: 'oauth', meta, scope, resource: prm?.resource || url };
}

/** A tiny loopback page the browser lands on after sign-in. */
const landing = (ok, text) => `<!doctype html><meta charset="utf-8"><title>Dispatch</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0}@media(prefers-color-scheme:light){body{background:#f6f6f4;color:#111}}main{max-width:420px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{margin:0;opacity:.75}</style><main><h1>${ok ? 'Connected to Dispatch' : 'Sign-in did not finish'}</h1><p>${text}</p></main>`;

/**
 * create({ file, vault, open, notify }):
 *   file: connectors.json; vault: { seal, open } (safeStorage); open(url): opens the system browser; notify(): something changed.
 */
function create({ file, vault, open, notify = () => {} }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { connections: {} }; } };
  // In one piece: a file caught half written read as "no connections".
  const write = data => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, JSON.stringify(data, null, 2)); fs.rmSync(tmp, { force: true }); } notify(); };
  const update = (id, patch) => { const d = read(); if (!d.connections[id]) return null; d.connections[id] = { ...d.connections[id], ...patch }; write(d); return d.connections[id]; };
  const secrets = c => { try { return c.secret ? JSON.parse(vault.open(c.secret)) : {}; } catch { return {}; } };
  const seal = obj => vault.seal(JSON.stringify(obj));
  const pending = new Map(); // id -> { cancel }
  const refreshing = new Map();
  const proxy = { url: '', token: crypto.randomBytes(16).toString('hex') };

  const entry = id => CATALOG.find(c => c.id === id);
  const publicView = c => ({ id: c.id, name: c.name, url: c.url || '', auth: c.auth, icon: c.icon || '', custom: !!c.custom, status: c.status, tools: c.tools ?? null, account: c.account || '', addedAt: c.addedAt, error: c.error || '' });
  const list = () => Object.values(read().connections).map(publicView);

  // The server said the sign-in itself is over. Anything else (no network, the laptop just woke up, a server error, a
  // bot check) passes: the connection stays and is tried again. Before, one such moment dropped it for good.
  const OVER = ['invalid_grant', 'invalid_client', 'unauthorized_client'];
  async function refresh(id) {
    if (refreshing.has(id)) return refreshing.get(id);
    const run = (async () => {
      const c = read().connections[id]; const s = secrets(c);
      if (!s.refresh_token) throw Object.assign(new Error('The server gave no refresh token, so the sign-in ends with the access token.'), { over: true });
      const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: s.client_id });
      if (s.client_secret) body.set('client_secret', s.client_secret);
      if (c.resource) body.set('resource', c.resource);
      const r = await fetch(s.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: timeout(30000) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) {
        if (OVER.includes(t.error)) {
          // Refresh tokens work once. Another Dispatch (second window, dev build) may have used this one a moment ago and
          // saved its successor: that one is good.
          for (const wait of [0, 1500]) {
            if (wait) await new Promise(res => setTimeout(res, wait));
            const now = secrets(read().connections[id] || {});
            if (now.access_token && now.refresh_token !== s.refresh_token) return now.access_token;
          }
        }
        throw Object.assign(new Error(t.error_description || t.error || `refresh failed (${r.status})`), { over: OVER.includes(t.error) });
      }
      const next = { ...s, access_token: t.access_token, refresh_token: t.refresh_token || s.refresh_token, expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : 0, refreshed_at: Date.now() };
      update(id, { secret: seal(next), status: 'connected', error: '' });
      return next.access_token;
    })().finally(() => refreshing.delete(id));
    refreshing.set(id, run);
    return run;
  }
  /** A valid access token, refreshed two minutes before it expires. rejected: the token the server just answered 401 to. */
  async function token(id, rejected = null) {
    const c = read().connections[id]; if (!c) return '';
    const s = secrets(c);
    if (c.auth === 'token') return s.access_token || '';
    if (c.auth !== 'oauth') return '';
    // Several calls fail together when a token ends: the first one renews it, the others take the new one.
    if (rejected !== null && s.access_token && s.access_token !== rejected) return s.access_token;
    if (rejected !== null || (s.expires_at && s.expires_at - 120000 < Date.now())) {
      try { return await refresh(id); }
      catch (e) {
        if (e.over) { update(id, { status: 'expired', error: String(e.message || e) }); return ''; }
        if (rejected === null && s.expires_at > Date.now()) return s.access_token; // still good for now
        throw e;
      }
    }
    return s.access_token || '';
  }
  // Renewed ahead of time, also while no agent uses it: a refresh token left alone for long is dropped by many servers.
  const triedAt = new Map();
  async function keepAlive() {
    for (const c of Object.values(read().connections)) {
      try {
        if (c.auth === 'oauth') {
          const s = secrets(c); if (!s.refresh_token) continue;
          const last = s.refreshed_at || c.addedAt || 0, soon = s.expires_at ? s.expires_at - 10 * 60000 < Date.now() : false;
          if (c.status === 'expired' && Date.now() - (triedAt.get(c.id) || 0) < 60 * 60000) continue;
          if (soon || c.status === 'expired' || Date.now() - last > 24 * 60 * 60000) {
            triedAt.set(c.id, Date.now());
            const was = c.status;
            await refresh(c.id);
            if (was !== 'connected') await check(c.id);
          } else if (c.status === 'error') await check(c.id);
        } else if (c.status === 'error' && c.auth !== 'local' && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(c.url || '')) await check(c.id);
      } catch (e) { if (e.over) update(c.id, { status: 'expired', error: String(e.message || e) }); }
    }
  }

  /** Calls initialize + tools/list through the upstream to confirm the connection and count tools. */
  async function check(id) {
    const c = read().connections[id]; if (!c || c.auth === 'local') return c;
    const call = async (msg, session, retry = true, rejected = null) => {
      const t = await token(id, rejected);
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(session ? { 'mcp-session-id': session } : {}) };
      const r = await fetch(c.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: timeout(20000) });
      if (r.status === 401 && retry && c.auth === 'oauth') { try { await r.body?.cancel(); } catch {} return call(msg, session, false, t); }
      return r;
    };
    try {
      const r = await call(INIT);
      if (r.status === 401) { try { await r.body?.cancel(); } catch {} return update(id, { status: 'expired', error: 'Sign-in expired' }); }
      if (!r.ok) { try { await r.body?.cancel(); } catch {} return update(id, { status: 'error', error: `Server answered ${r.status}` }); }
      const session = r.headers.get('mcp-session-id') || '';
      const init = await readRpc(r, 1);
      const n = await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, session); try { await n.body?.cancel(); } catch {}
      const tl = await readRpc(await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session), 2);
      return update(id, { status: 'connected', error: '', tools: tl?.result?.tools?.length ?? null, serverName: init?.result?.serverInfo?.name || '' });
    } catch (e) { return update(id, { status: 'error', error: e.cause?.code === 'ECONNREFUSED' ? (entry(id)?.hint ? `Not running. ${entry(id).hint}` : 'Not running') : String(e.message || e) }); }
  }

  /** Browser sign-in: register Dispatch with the server, open the consent page, catch the code on loopback. */
  async function signIn(info) {
    const { meta, scope, resource } = info;
    const srv = http.createServer();
    await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '127.0.0.1', res); });
    const redirect = `http://127.0.0.1:${srv.address().port}/callback`;
    try {
      const reg = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_name: 'Dispatch', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...(scope ? { scope } : {}) }), signal: timeout() });
      const client = await reg.json().catch(() => ({}));
      if (!reg.ok || !client.client_id) throw new Error(`The server refused to register Dispatch (${client.error_description || client.error || reg.status}).`);
      const verifier = crypto.randomBytes(32).toString('base64url');
      const state = crypto.randomBytes(16).toString('base64url');
      const auth = new URL(meta.authorization_endpoint);
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, resource, ...(scope ? { scope } : {}) })) auth.searchParams.set(k, v);
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), 5 * 60000);
        info.cancel = () => { clearTimeout(timer); reject(new Error('cancelled')); };
        srv.on('request', (req, res) => {
          const q = new URL(req.url, redirect);
          if (q.pathname !== '/callback') { res.writeHead(404); return res.end(); }
          const ok = q.searchParams.get('state') === state && q.searchParams.get('code');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(landing(!!ok, ok ? 'You can close this tab and go back to Dispatch.' : (q.searchParams.get('error_description') || q.searchParams.get('error') || 'Go back to Dispatch and try again.')));
          clearTimeout(timer);
          ok ? resolve(q.searchParams.get('code')) : reject(new Error(q.searchParams.get('error_description') || q.searchParams.get('error') || 'Sign-in was not completed.'));
        });
        open(auth.toString());
      });
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier, resource });
      if (client.client_secret) body.set('client_secret', client.client_secret);
      const r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: timeout() });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) throw new Error(`Sign-in failed: ${t.error_description || t.error || r.status}`);
      return { client_id: client.client_id, client_secret: client.client_secret || '', token_endpoint: meta.token_endpoint, access_token: t.access_token, refresh_token: t.refresh_token || '', expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : 0, refreshed_at: Date.now() };
    } finally { srv.close(); }
  }

  /** Adds a catalog entry or a custom { name, url, token? }. Opens the browser when the server needs a sign-in. */
  async function connect(input) {
    const base = typeof input === 'string' ? entry(input) : input?.catalog ? entry(input.catalog) : null;
    const custom = !base;
    const c = base ? { ...base } : { id: 'custom_' + slug(input?.name || input?.url), name: String(input?.name || '').trim(), url: String(input?.url || '').trim(), auth: input?.token ? 'token' : 'auto', custom: true };
    if (!c.name) throw new Error('Give the server a name.');
    if (c.auth !== 'local' && !/^https?:\/\//i.test(c.url || '')) throw new Error('The address must start with https://');
    if (pending.has(c.id)) throw new Error(`${c.name} is already waiting for the browser.`);
    const info = { cancel: () => {} };
    pending.set(c.id, info); notify();
    try {
      let secret = {};
      if (c.auth === 'token') { const tk = String(input?.token || '').trim(); if (!tk) throw new Error('Paste a token.'); secret = { access_token: tk }; }
      else if (c.auth === 'oauth' || c.auth === 'auto') {
        const found = await discover(c.url, c.auth === 'oauth');
        c.auth = found.auth;
        if (found.auth === 'oauth') { Object.assign(info, found); secret = await signIn(info); c.resource = found.resource; }
      } else if (c.auth === 'none' && /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(c.url)) {
        // A server on this computer (Figma desktop): say plainly when it is not running instead of saving a dead connection.
        try { const r = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(INIT), signal: timeout() }); try { await r.body?.cancel(); } catch {} }
        catch (e) { throw new Error(`${c.name} is not running on this computer. ${c.hint || `Start it and try again (${c.url}).`}`); }
      }
      const d = read();
      d.connections[c.id] = { id: c.id, name: c.name, url: c.url || '', auth: c.auth, icon: c.icon || '', custom, resource: c.resource || '', command: c.command, args: c.args, secret: Object.keys(secret).length ? seal(secret) : '', status: 'connected', addedAt: Date.now() };
      write(d);
    } finally { pending.delete(c.id); notify(); }
    await check(c.id);
    return publicView(read().connections[c.id]);
  }
  // 'custom' cancels whichever custom server is waiting (the dialog does not know the id it gets).
  const cancel = id => { for (const [k, v] of pending) if (k === id || (id === 'custom' && k.startsWith('custom_'))) v.cancel(); };
  /** Log out: forgets the tokens and the connection. Agents lose it on their next start. */
  function remove(id) { const d = read(); delete d.connections[id]; write(d); return true; }

  /** What agents get: loopback proxy URLs for remote servers, a command for local ones. */
  function forAgents() {
    return Object.values(read().connections).filter(c => c.status !== 'expired').map(c => c.auth === 'local'
      ? { id: slug(c.id), name: c.name, command: c.command, args: c.args || [] }
      : { id: slug(c.id), name: c.name, url: proxy.url ? `${proxy.url}/${encodeURIComponent(c.id)}` : '' }).filter(x => x.command || x.url);
  }

  // Loopback proxy: http://127.0.0.1:<port>/<secret>/<id>. Streams responses (SSE included) back to the agent.
  const PASS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
  const server = http.createServer(async (req, res) => {
    const m = /^\/([0-9a-f]{32})\/([^/?]+)/.exec(req.url || '');
    const c = m && m[1] === proxy.token ? read().connections[decodeURIComponent(m[2])] : null;
    if (!c || c.auth === 'local') { res.writeHead(404); return res.end(); }
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const ac = new AbortController(); res.on('close', () => ac.abort());
    let used = '';
    const send = async rejected => {
      const t = used = await token(c.id, rejected);
      const headers = {}; for (const h of PASS) if (req.headers[h]) headers[h] = req.headers[h];
      if (t) headers.authorization = `Bearer ${t}`;
      return fetch(c.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, signal: ac.signal });
    };
    try {
      let r = await send(null);
      if (r.status === 401 && c.auth === 'oauth') { try { await r.body?.cancel(); } catch {} r = await send(used); }
      if (r.status === 401) {
        try { await r.body?.cancel(); } catch {}
        update(c.id, { status: 'expired', error: 'Sign-in expired' });
        // Not 401: the agent's own CLI would try to sign in to the proxy. The message tells the agent what to say.
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: `${c.name} needs a new sign-in. Ask the user to reconnect it in Dispatch under MCP.` } }));
      }
      const out = {}; for (const h of ['content-type', 'mcp-session-id', 'cache-control']) { const v = r.headers.get(h); if (v) out[h] = v; }
      res.writeHead(r.status, out);
      if (r.body) Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res); else res.end();
    } catch (e) {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32002, message: `${c.name} could not be reached: ${e.cause?.code || e.message}` } }));
    }
  });
  const ready = new Promise(res => server.listen(0, '127.0.0.1', () => { proxy.url = `http://127.0.0.1:${server.address().port}/${proxy.token}`; res(); }));
  server.unref?.();
  const timers = [setTimeout(() => void keepAlive(), 15000), setInterval(() => void keepAlive(), 5 * 60000)]; timers.forEach(t => t.unref?.());

  return { catalog: () => ({ groups: GROUPS, items: CATALOG.map(({ command: _c, args: _a, ...x }) => x) }), list, pending: () => [...pending.keys()], connect, cancel, remove, check, forAgents, ready, token, keepAlive, close: () => { clearTimeout(timers[0]); clearInterval(timers[1]); server.close(); } };
}

// One hub for the whole app. Every project tab had its own: two of them renewed the same one-time refresh token at once,
// the server refused the second (some end the whole sign-in then) and the connection dropped by itself.
const hubs = new Map();
function shared({ file, vault, open, notify = () => {} }) {
  const key = path.resolve(file).toLowerCase();
  let h = hubs.get(key);
  if (!h) { const listeners = new Set(); h = { listeners, hub: create({ file, vault, open, notify: () => { for (const f of listeners) try { f(); } catch {} } }) }; hubs.set(key, h); }
  h.listeners.add(notify);
  return { ...h.hub, close: () => h.listeners.delete(notify) };
}
/** After sleep: tokens may have run out meanwhile. */
const wake = () => { for (const { hub } of hubs.values()) void hub.keepAlive(); };

module.exports = { CATALOG, GROUPS, create, shared, wake, discover, readRpc, slug };
