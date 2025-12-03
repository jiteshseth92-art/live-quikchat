import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(express.json());
app.use(cors());

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

app.get("/", (req, res) => {
  res.send("QuikChat LiveKit Server Running");
});

app.get("/getToken", async (req, res) => {
  const identity = `user-${Math.floor(Math.random() * 999999)}`;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
  });

  at.addGrant({
    roomJoin: true,
    room: "quikchat-room",
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  res.send({ token });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("LiveKit Signal Server on PORT:", port));
