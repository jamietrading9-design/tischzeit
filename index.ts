import express from "express";
import serverApp from "./server/index.js";

const app = express();
app.use(serverApp);

export default app;
