/** Shared Socket.IO instance accessor for services outside request scope. */

let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function getIo() {
  return ioInstance;
}

module.exports = {setIo, getIo};
