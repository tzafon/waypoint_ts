# Tzafon Waypoint (Node/TS)

A **Node.js / TypeScript** client for `tzafon.ai` web-automation API.

## Install

```bash
npm i @tzafon/waypoint
```

## Example

```typescript
import { Waypoint } from "@tzafon/waypoint";

async function main() {
  console.log("start");
  const wp = new Waypoint("your-waypoint-token");
  await wp.connect();
  await wp.goto("https://tzafon.ai");
  await wp.screenshot("screenshot.jpg");
  await wp.click(100, 200);
  await wp.type("Hello world");
  await wp.scroll(0, 200);
  await wp.close();
  console.log("close");
}

await main();
```
