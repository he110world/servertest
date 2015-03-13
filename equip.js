var util = require('./util');

function Equip (id, mapLevel) {
	mapLevel = mapLevel || 1;

	// how many extended properties?
	var p = Math.random();
	var cnt = 0;
	var point = 0;
	if (p > 0.42) {
		if (p < 0.84) {
			cnt = 1;
			point = 5;
		} else if (p < 0.98) {
			cnt = 2;
			point = 10;
		} else {
			cnt = 3;
			point = 15;
		}

		var goodPoint = [0,1,1,2,3,4,6,8,10,12,15];
		var addFactor = [0,375,240,300,255,247];

		for (var i=0; i<cnt; i++) {
			// which type? there're five of them equally distributed
			var type = util.randomIntBetween(0,4);

			// percentage or addition?
			var isAdd = Math.random() < 0.5;

			// bad or good?
			var badPercent = 0.9 - (0.8 * (mapLevel - 1) / 998);
			var isGood = Math.random() > badPercent;
			var goodness = isGood * 5 + util.randomIntBetween(1,5);

			var id = type * 20 + isAdd * 10 + goodness;
			point += goodPoint[goodness];

			// write type
			var idx = i+1;
			this['ExtendAdd'+idx] = type+1;

			// write value
			if (isAdd) {	// positive
				this['AddValue'+idx] = goodness * addFactor[goodness];
			} else {		// negative
				this['AddValue'+idx] = -goodness;
			}
		}
	}

	// rareness
	var rare;
	if (point < 5) {
		rare = 1;
	} else if (point < 20) {
		rare = 2;
	} else if (point < 30) {
		rare = 3;
	} else if (point < 40) { 
		rare = 4;
	} else {
		rare = 5;
	}
	this.Rare = rare;
	this.ID = id;
}

module.exports = Equip;
