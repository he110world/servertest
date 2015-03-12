// MapReduce module
function MapReduce () {
}

function err (str) {
	console.log('MapReduce error: ' + str);
}

// Map:
// Filter: ['f', function(element) {return null || element}]
// [...100 elements...] => [...50 elements...]
//
// Slicer: ['s', function(element) {return ['slice name', element]}
// [...100 elements...] => [...20 elements...], [...30 elements...], [...40 elements...]
//
// Reduce: function([...elements...]) 
//
// Usage:
// mapReduce(somearray, ['f', paid, 's', whichOS, 's', whichLv], countUsers, function(err, result){
//		console.log(result);
// });
// > {"Android:1":10, "Android:2~10":5 ..}
MapReduce.prototype.mapReduce = function (data, map, reduce, cb) {
	if (typeof cb != 'function') {
		err('no callback');
		return;
	}

	if (typeof reduce != 'function') {
		err('no reduce function');
		return;
	}

	if (map.length <2 || map.length % 2 != 0) {
		err('wrong parameters');
		cb(true);
		return;
	}

	for (var i=0; i<map.length; i+=2) {
		var type = map[i];
		var func = map[i+1];
		if (type == 'f') {	// filter
		} else if (type == 's') {	// slicer
		}
	}
};

module.exports = new MapReduce();
