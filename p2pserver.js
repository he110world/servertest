if (process.argv.length < 3) {
	console.log('Usage: node p2pserver.js <port>');
	process.exit();
}

var dgram = require('dgram');
var server = dgram.createSocket('udp4');
var port = process.argv[2];

server.on('listening', function () {
	var address = server.address();
	console.log('P2P Server listening on ' + address.address + ":" + address.port);
});

var MsgType = {
	REG : 0,
	UNREG: 1,
	QRY : 2,
	PING: 3,
	PONG: 4,
	SYNC: 5,
	MSG : 6,
	ACK : 7,
	DEBUG : 255
};

var endpoints = {};
server.on('message', function (msg, remote) {
	var type = msg[0];
	//console.log(type);
	if (type == MsgType.REG) {
		var uid = msg.readInt32LE(2);
		remote.time = Date.now();	// timeout: 5s
		endpoints[uid] = remote;
//		console.log('reg:',uid);
		server.send(msg, 0, msg.length, remote.port, remote.address);

//		console.log(remote);

	} else if (type == MsgType.UNREG) {
		var uid = msg.readInt32LE(2);
		//console.log('unreg:',uid);
		delete endpoints[uid];
	} else if (type == MsgType.QRY) {
		var uid = msg.readInt32LE(6);
		var ep = endpoints[uid];
		//console.log(uid,ep);
		if (ep && Date.now() - ep.time < 5000) {
			var buf1 = new Buffer(2);
			var buf2 = new Buffer(ep.address + ':' + ep.port);
			buf1.writeInt16LE(buf2.length, 0);
			var buf = Buffer.concat([msg, buf1, buf2]);
			server.send(buf, 0, buf.length, remote.port, remote.address);
		}
	} else if (type == MsgType.DEBUG) {
		console.log('%s dbg: %s', msg.readInt32LE(2), msg.toString('ascii',12));
	} else {	// relay
		var srcuid = msg.readInt32LE(2);
		var dstuid = msg.readInt32LE(6);
		var ep = endpoints[dstuid];
		if (ep) {
			/*
			if (type == MsgType.MSG) {
			//	console.log('msg -> %s', uid);
			} else {
				console.log(srcuid + ' -> ' + dstuid);
			//	console.log('relay', uid, ep);
			}
			*/
			server.send(msg, 0, msg.length, ep.port, ep.address);
		}
	}
});

server.bind(port);
