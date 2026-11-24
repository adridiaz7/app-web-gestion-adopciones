import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();

createApp().listen(config.port, () => {
  console.log(`Lagun escuchando en http://localhost:${String(config.port)} (${config.nodeEnv})`);
});
