// server/roomState.js

const roomStates = new Map();

export function getRoomState(roomId) {
  return roomStates.get(roomId);
}

export function updateRoomState(roomId, newState) {
  const prev = roomStates.get(roomId) || {};

  const updated = {
    ...prev,
    ...newState
  };

  roomStates.set(roomId, updated);

  return updated;
}