# A Thousand Lives

You live once. AI can live your life a thousand times.

Type any decision you cannot make ("Should I quit my job and start my own business?", "Should I study abroad?"). The app researches it, asks a few questions about your situation, simulates 1,000 versions of the next ten years, then lets you meet the people who lived them.

Built for the Nebius x NVIDIA Global AI Hackathon.

## What it does

- **Research any decision**: Tavily searches the web for real statistics on the decision you typed. NVIDIA Nemotron reads the results and builds the questions, the yearly odds and the outcome scale. Every number is marked as sourced (with a link) or as an AI assumption.
- **Simulate**: 1,000 lives over 10 years. For the built-in startup decision, yearly closure risk follows the U.S. BLS business survival curve, adjusted by industry, with a Korea adjustment from national statistics when the page is in Korean.
- **Meet one life**: pick any dot and ask that version of you anything. Answered live by NVIDIA Nemotron on Nebius Token Factory, grounded only in the facts of that simulated life.
- **Ask all thousand**: put your own question to the crowd. Twelve representative lives answer live through Nemotron, and the other lives are grouped with the closest of those twelve.
- **Come back**: record where you really are at any point. The app filters the lives that match, re-simulates from there when too few match, and redraws the forecast.

## How Nebius and NVIDIA are used

`api/chat.js` is a small serverless function that calls Nebius Token Factory's OpenAI-compatible API with an NVIDIA Nemotron model. It also calls Tavily search to ground each new decision in real sources. Both keys stay on the server.

## Run it

Deploy this folder to any host that runs Node serverless functions from `/api` (Vercel works with no configuration).

Environment variables:

| Name | Required | Default |
| --- | --- | --- |
| `NEBIUS_API_KEY` | yes | |
| `TAVILY_API_KEY` | for any-decision mode | |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_MODEL_FALLBACK` | no | `nvidia/nvidia-nemotron-3-nano-30b-a3b` |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1/` |

Open `/api/chat` in a browser to check that the key is set. Without a key the app still runs, with example answers instead of live ones.

## Honest limits

The simulation is a statistical sketch, not a prediction. For decisions other than the built-in one, numbers without a source are AI assumptions and are labelled as such. For the startup decision, survival curves are real; the effect sizes of experience, customers, savings and partners are assumptions. Check-ins are stored in the browser only.
