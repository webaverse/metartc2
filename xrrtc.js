import RoomClient from './client/RoomClient.js';

/* const defaultIceServers = [
  {'urls': 'stun:stun.stunprotocol.org:3478'},
  {'urls': 'stun:stun.l.google.com:19302'},
]; */

const roomAlphabetStartIndex = 'A'.charCodeAt(0);
const roomAlphabetEndIndex = 'Z'.charCodeAt(0)+1;
const roomIdLength = 4;
function makeId() {
  let result = '';
  for (let i = 0; i < roomIdLength; i++) {
    result += String.fromCharCode(roomAlphabetStartIndex + Math.floor(Math.random() * (roomAlphabetEndIndex - roomAlphabetStartIndex)));
  }
  return result;
}

class XRChannelConnection extends EventTarget {
  constructor(url, options = {}) {
    super();

    this.connectionId = makeId();
    this.peerConnections = [];
    this.dataChannel = null;

    // console.log('local connection id', this.connectionId);

    const _getPeerConnection = peerConnectionId => this.peerConnections.find(peerConnection => peerConnection.connectionId === peerConnectionId);
    const _addPeerConnection = (peerConnectionId, dataChannel) => {
      let peerConnection = _getPeerConnection(peerConnectionId);
      if (!peerConnection) {
        peerConnection = new XRPeerConnection(peerConnectionId, dataChannel, this);
        // console.log('add peer connection', peerConnection);
        this.peerConnections.push(peerConnection);
        this.dispatchEvent(new MessageEvent('peerconnection', {
          data: peerConnection,
        }));
      }
      return peerConnection;
    };
    const _removePeerConnection = peerConnectionId => {
      const index = this.peerConnections.findIndex(peerConnection => peerConnection.connectionId === peerConnectionId);
      if (index !== -1) {
        this.peerConnections.splice(index, 1)[0].close();
      } else {
        console.warn('no such peer connection', peerConnectionId, this.peerConnections.map(peerConnection => peerConnection.connectionId));
      }
    };

    const {roomName = 'room', displayName = 'user'} = options;
    const dialogClient = new RoomClient({
      url: `${url}?roomId=${roomName}&peerId=${this.connectionId}`,
      displayName,
    });
    dialogClient.addEventListener('addsend', async e => {
      const {data: {dataProducer: {id, _dataChannel}}} = e;
      // console.log('add send', _dataChannel);
      if (_dataChannel.readyState !== 'open') {
        await new Promise((accept, reject) => {
          const _open = e => {
            accept();

            _dataChannel.removeEventListener('open', _open);
          };
          _dataChannel.addEventListener('open', _open);
        });
      }
      /* _dataChannel.addEventListener('message', e => {
        console.log('got send data', e);
      }); */
      this.dataChannel = _dataChannel;

      this.dispatchEvent(new MessageEvent('open', {
        data: {},
      }));
    });
    dialogClient.addEventListener('removesend', e => {
      const {data: {dataProducer: {id, _dataChannel}}} = e;
      // console.log('remove send', _dataChannel);
      this.dataChannel = null;
    });
    dialogClient.addEventListener('addreceive', e => {
      const {data: {peerId, label, dataConsumer: {id, _dataChannel}}} = e;
      // console.log('add data receive', peerId, label, _dataChannel);
      if (peerId) {
        const peerConnection = _addPeerConnection(peerId, _dataChannel);
        _dataChannel.addEventListener('message', e => {
          const {data} = e;
          peerConnection.dispatchEvent(new MessageEvent('message', {
            data,
          }));
        });
        _dataChannel.addEventListener('close', e => {
          _removePeerConnection(peerId);
        });
        // peerConnection.setDataChannel(_dataChannel);
      }
    });
    dialogClient.addEventListener('removereceive', e => {
      const {data: {peerId, label, dataConsumer: {id, _dataChannel}}} = e;
      // console.log('remove data receive', peerId, label, _dataChannel);

      /* if (peerId) {
        _removePeerConnection(peerId);
      } */
    });
    dialogClient.addEventListener('addreceivestream', e => {
      const {data: {peerId, consumer: {id, _track}}} = e;
      // console.log('add receive stream', peerId, _track);
      if (peerId) {
        const peerConnection = _getPeerConnection(peerId);
        if (peerConnection) {
          peerConnection.addTrack(_track);
        } else {
          console.warn('no peer connection with id', peerId);
        }
      }
    });
    dialogClient.addEventListener('removereceivestream', e => {
      const {data: {peerId, consumer: {id, _track}}} = e;
      // console.log('remove receive stream', peerId, _track);
      if (peerId) {
        const peerConnection = _getPeerConnection(peerId);
        if (peerConnection) {
          peerConnection.removeTrack(_track);
        } else {
          console.warn('no peer connection with id', peerId);
        }
      }
    });
    (async () => {
      await dialogClient.join();
      await dialogClient.enableChatDataProducer();
      // await dialogClient.enableMic();
      // await dialogClient.enableWebcam();
    })();
    this.dialogClient = dialogClient;
  }

  close() {
    this.dialogClient.close();
  }

  /* disconnect() {
    this.rtcWs.close();
    this.rtcWs = null;

    for (let i = 0; i < this.peerConnections.length; i++) {
      this.peerConnections[i].close();
    }
    this.peerConnections.length = 0;
  } */

  send(s) {
    this.dataChannel.send(s);
  }
  
  async enableMic() {
    await this.dialogClient.enableMic();
    return this.dialogClient._micProducer._track;
  }
  async disableMic() {
    await this.dialogClient.disableMic();
  }
}

class XRPeerConnection extends EventTarget {
  constructor(peerConnectionId, dataChannel, channelConnection) {
    super();

    this.connectionId = peerConnectionId;
    this.dataChannel = dataChannel;
    this.channelConnection = channelConnection;
    this.open = true;

    /* this.peerConnection.ontrack = e => {
      const mediaStream = new MediaStream();
      mediaStream.addTrack(e.track);
      this.dispatchEvent(new MessageEvent('mediastream', {
        detail: mediaStream,
      }));
    };

    const sendChannel = this.peerConnection.createDataChannel('sendChannel');
    this.peerConnection.sendChannel = sendChannel;
    let pingInterval = 0;
    sendChannel.onopen = () => {
      // console.log('data channel local open');

      this.open = true;
      this.dispatchEvent(new MessageEvent('open'));
    };
    sendChannel.onclose = () => {
      console.log('send channel got close');

      _cleanup();
    };
    sendChannel.onerror = err => {
      // console.log('data channel local error', err);
    };
    this.peerConnection.ondatachannel = e => {
      const {channel} = e;
      // console.log('data channel remote open', channel);
      channel.onclose = () => {
        // console.log('data channel remote close');
        this.peerConnection.close();
      };
      channel.onerror = err => {
        // console.log('data channel remote error', err);
      };
      channel.onmessage = e => {
        // console.log('data channel message', e.data);

        const data = JSON.parse(e.data);
        const {method} = data;
        if (method === 'pose') {
          this.dispatchEvent(new MessageEvent('pose', {
            detail: data,
          }))
        } else {
          this.dispatchEvent(new MessageEvent('message', {
            data: e.data,
          }));
        }

        // _kick();
      };
      this.peerConnection.recvChannel = channel;
    };
    this.peerConnection.close = (close => function() {
      _cleanup();

      return close.apply(this, arguments);
    })(this.peerConnection.close);
    const _cleanup = () => {
      if (this.open) {
        this.open = false;
        this.dispatchEvent(new MessageEvent('close'));
      }
      if (this.token !== -1) {
        clearTimeout(this.token);
        this.token = -1;
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = 0;
      }
    }; */
  }
  close() {
    /* this.peerConnection.close();
    this.peerConnection.sendChannel && this.peerConnection.sendChannel.close();
    this.peerConnection.recvChannel && this.peerConnection.recvChannel.close(); */
    this.open = false;
    this.dispatchEvent(new MessageEvent('close', {
      data: {},
    }));
  }

  setDataChannel(dataChannel) {
    this.dataChannel = dataChannel;
  }
  addTrack(track) {
    console.log('add track', track);
  }
  removeTrack(track) {
    console.log('remove track', track);
  }
}

export {
  makeId,
  XRChannelConnection,
  XRPeerConnection,
};