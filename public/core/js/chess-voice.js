/**
 * Chess PVP — real-time voice chat (WebRTC audio only)
 */
const ChessVoice = (() => {
  const ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  let socket = null;
  let gameId = null;
  let opponentSocketId = null;
  let pc = null;
  let localStream = null;
  let remoteAudio = null;
  let voiceOn = false;
  let micMuted = false;

  function init(sock) {
    socket = sock;
    remoteAudio = document.getElementById('chessRemoteAudio');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'chessRemoteAudio';
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      document.body.appendChild(remoteAudio);
    }

    socket.on('chess-rtc', handleSignal);
    bindUI();
  }

  function bindUI() {
    document.getElementById('chessVoiceToggle')?.addEventListener('click', toggleVoice);
    document.getElementById('chessMicMute')?.addEventListener('click', toggleMicMute);
  }

  function setPeers(gid, whiteSid, blackSid, mySocketId) {
    gameId = gid;
    if (!whiteSid || !blackSid) {
      opponentSocketId = null;
      updateVoiceUI('waiting');
      return;
    }
    opponentSocketId = mySocketId === whiteSid ? blackSid : whiteSid;
    updateVoiceUI('ready');
  }

  function clearPeers() {
    stopVoice();
    gameId = null;
    opponentSocketId = null;
    updateVoiceUI('off');
  }

  async function toggleVoice() {
    if (voiceOn) {
      stopVoice();
      return;
    }
    if (!opponentSocketId || !gameId) {
      showToast?.('Waiting for an opponent to join');
      return;
    }
    await startVoice();
  }

  async function startVoice() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      voiceOn = true;
      micMuted = false;
      updateVoiceUI('connecting');

      const amOfferer = socket.id < opponentSocketId;
      pc = new RTCPeerConnection(ICE);
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      pc.ontrack = (e) => {
        if (e.track.kind === 'audio' && remoteAudio) {
          remoteAudio.srcObject = e.streams[0] || new MediaStream([e.track]);
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate });
      };

      pc.oniceconnectionstatechange = () => {
        const s = pc?.iceConnectionState;
        if (s === 'connected' || s === 'completed') updateVoiceUI('connected');
        if (s === 'failed') {
          pc?.restartIce();
          updateVoiceUI('reconnecting');
        }
        if (s === 'disconnected') updateVoiceUI('reconnecting');
      };

      if (amOfferer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer });
      }
    } catch (err) {
      console.warn('[ChessVoice]', err);
      stopVoice();
      showToast?.('Microphone access denied or unavailable');
      updateVoiceUI('error');
    }
  }

  function stopVoice() {
    voiceOn = false;
    micMuted = false;
    if (pc) {
      pc.close();
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (remoteAudio) remoteAudio.srcObject = null;
    updateVoiceUI(opponentSocketId ? 'ready' : 'off');
  }

  function toggleMicMute() {
    if (!localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
    updateVoiceUI(voiceOn ? (micMuted ? 'muted' : 'connected') : 'ready');
  }

  function sendSignal(data) {
    if (!socket || !gameId || !opponentSocketId) return;
    socket.emit('chess-rtc', {
      gameId,
      to: opponentSocketId,
      data,
    });
  }

  async function handleSignal({ from, data }) {
    if (!data || from !== opponentSocketId) return;

    try {
      if (data.type === 'offer') {
        if (!pc) {
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          voiceOn = true;
          pc = new RTCPeerConnection(ICE);
          localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
          pc.ontrack = (e) => {
            if (e.track.kind === 'audio' && remoteAudio) {
              remoteAudio.srcObject = e.streams[0] || new MediaStream([e.track]);
            }
          };
          pc.onicecandidate = (e) => {
            if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate });
          };
          pc.oniceconnectionstatechange = () => {
            const s = pc?.iceConnectionState;
            if (s === 'connected' || s === 'completed') updateVoiceUI('connected');
          };
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: answer });
        updateVoiceUI('connecting');
      } else if (data.type === 'answer' && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        updateVoiceUI('connected');
      } else if (data.type === 'ice' && pc && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (err) {
      console.warn('[ChessVoice] signal error', err);
    }
  }

  function updateVoiceUI(state) {
    const status = document.getElementById('chessVoiceStatus');
    const toggle = document.getElementById('chessVoiceToggle');
    const muteBtn = document.getElementById('chessMicMute');
    const panel = document.getElementById('chessVoicePanel');

    if (panel) panel.classList.toggle('active', state !== 'off' && state !== 'waiting');

    const labels = {
      off: 'Voice chat — available in Online PVP',
      waiting: 'Voice unlocks when opponent joins',
      ready: 'Ready — tap Join Voice to talk',
      connecting: 'Connecting voice…',
      connected: 'Voice connected',
      reconnecting: 'Reconnecting…',
      muted: 'Mic muted',
      error: 'Voice unavailable',
    };
    if (status) status.textContent = labels[state] || state;

    if (toggle) {
      toggle.textContent = voiceOn ? 'Leave Voice' : 'Join Voice';
      toggle.classList.toggle('on', voiceOn);
      toggle.disabled = !opponentSocketId || state === 'waiting';
    }
    if (muteBtn) {
      muteBtn.disabled = !voiceOn;
      muteBtn.classList.toggle('muted', micMuted);
      const micIcon = muteBtn.querySelector('[data-lucide]');
      if (micIcon) micIcon.setAttribute('data-lucide', micMuted ? 'mic-off' : 'mic');
    }
    if (window.lucide) lucide.createIcons();
  }

  /** Auto-join voice when match starts (optional — user can leave) */
  async function autoConnect() {
    if (!opponentSocketId || voiceOn) return;
    await startVoice();
  }

  return { init, setPeers, clearPeers, stopVoice, autoConnect };
})();
