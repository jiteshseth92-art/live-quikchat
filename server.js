import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_URL = "wss://quikchat-z062h7l1.livekit.cloud";
const LIVEKIT_API_KEY = "APIUxHVxWWDYkk7";
const LIVEKIT_API_SECRET = "WtWnIzlW7HxbMTfkswbxSvLDimwtgRDPf2ZEI08HOJb";

// generate token route
app.post("/getToken", (req, res) => {
  const { identity, roomName } = req.body;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
  });

  at.addGrant({
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    room: roomName,
  });

  const token = at.toJwt();
  res.json({ token });
});

app.listen(4000, () => console.log("Token server started on port 4000"));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});
