/* 
## Using mongodb to store kpi data

   can get real-time kpi
   everyday is a collection (name is date, e.g. 2015-3-11)
   * updated on every game log
   * real-time data is computed upon request (maybe some caching?)
   * at the end of the day, data in the collection can be used to compute further kpi info

   game log is sent by UDP: if server is down, don't bother reconnect

### Data Ops:
     set/incr/addToSet (decr=-incr)

### Incoming Messages:
	 [<op type>, <collection>, <query>, <field>, <val>]*

	 e.g.
     ["s","user","uid:10000","os",1,"i","user","uid:10000","girlcnt",1]
*/
var mongo = require('mongodb').MongoClient;
var mongourl = process.argv[2];
if (!mongourl) {
	mongourl = 'mongodb://localhost:27017';
}

var collections = {};
mongo.connect(mongourl + '/kpi', function(err, db) {
	if (err) {
		console.log('db err');
		return;
	}

	console.log('MongoDB connected to ' + mongourl);

	// listen to UDP msg
	var dgram = require('dgram');
	var udp = dgram.createSocket('udp4');
	var port = 5566;	// TODO: options!

	udp.on('listening', function () {
		var address = udp.address();
		console.log('KPI Server listening on ' + address.address + ":" + address.port);
	});

	udp.on('message', function (msg, remote) {
		// buffer to json array
		var str = msg.toString();
		try {
			var cmd = JSON.parse(str);
			console.log(cmd);

			var onErr = function (err){
				if (err) {
					throw new Error();
				}
			};

			//[<op type>, <collection>, <query>, <field>, <val>]*
			for (var i=0; i<cmd.length; i+=5) {
				// collection
				var colname = cmd[i+1];
				var col = collections[colname];
				if (!col) {
					col = db.collection(colname);
					collections[colname] = col;
				}

				var qry = cmd[i+2].split(':');
				var field = cmd[i+3];
				var val = cmd[i+4];
				var op = cmd[i];
				var qryobj = {};
				var updop = {};
				qryobj[qry[0]] = qry[1];
				updop[field] = val;
				var updobj = {};
				if (op == 'i') {
					updobj.$inc = updop;
				} else if (op == 's') {
					updobj.$set = updop;
				} else if (op == 'a') {
					updobj.$addToSet = updop;
				} else {
					throw new Error();
				}

				col.update(qryobj, updobj, {upsert:true}, onErr);
			}
		} catch (e) {
			console.log('invalid json: '+str);
		}
	});

	udp.bind(port);
});
