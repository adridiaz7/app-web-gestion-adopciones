import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { startJobs } from "./jobs/index.js";

const config = getConfig();

startJobs();

createApp().listen(config.port, () => {
  console.log(`Lagun escuchando en http://localhost:${String(config.port)} (${config.nodeEnv})`);
});
