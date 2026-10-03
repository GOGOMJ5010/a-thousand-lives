# A Thousand Lives

You live once. AI can live your life a thousand times.

Answer 17 questions about a decision you cannot make ("Should I quit my job and start my own business?"). The app simulates 1,000 versions of the next ten years from real business survival statistics, then lets you meet the people who lived them.

Built for the Nebius x NVIDIA Global AI Hackathon.

## What it does

- **Simulate**: 1,000 lives over 10 years. Yearly closure risk follows the U.S. BLS business survival curve, adjusted by industry, with a Korea adjustment from national statistics when the page is in Korean.
- **Meet one life**: pick any dot and ask that version of you anything. Answered live by NVIDIA Nemotron on Nebius Token Factory, grounded only in the facts of that simulated life.
- **Ask all thousand**: put your own question to the crowd. Twelve representative lives answer live through Nemotron, and the other lives are grouped with the closest of those twelve.
- **Come back**: record where you really are at any point. The app filters the lives that match, re-simulates from there when too few match, and redraws the forecast.

## How Nebius and NVIDIA are used

`api/chat.js` is a small serverless function that calls Nebius Token Factory's OpenAI-compatible API with an NVIDIA Nemotron model. The API key stays on the server.

## Run it

Deploy this folder to any host that runs Node serverless functions from `/api` (Vercel works with no configuration).

Environment variables:

| Name | Required | Default |
| --- | --- | --- |
| `NEBIUS_API_KEY` | yes | |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_MODEL_FALLBACK` | no | `nvidia/nvidia-nemotron-3-nano-30b-a3b` |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1/` |

Open `/api/chat` in a browser to check that the key is set. Without a key the app still runs, with example answers instead of live ones.

## Honest limits

The simulation is a statistical sketch, not a prediction. Survival curves are real; the effect sizes of experience, customers, savings and partners are assumptions. Check-ins are stored in the browser only.
