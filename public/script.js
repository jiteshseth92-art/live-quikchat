import { connect } from "https://cdn.skypack.dev/livekit-client";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");

async function startCall() {
  const res = await fetch("/token");
  const { token, url } = await res.json();

  const room = await connect(url, token);

  await room.localParticipant.setCameraEnabled(true);
  await room.localParticipant.setMicrophoneEnabled(true);

  room.on("trackSubscribed", (track) => {
    remoteVideo.srcObject = track.mediaStream;
    remoteVideo.play();
  });

  room.on("localTrackPublished", (pub) => {
    const track = pub.track;
    localVideo.srcObject = track.mediaStream;
    localVideo.play();
  });
}

findBtn.onclick = startCall;
