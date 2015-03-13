function Util () {
}

Util.prototype.updateLevel = function (newExp, lv, lvLimit, expTable) {
	while (lv<=lvLimit) {
		lvUpExp = expTable[lv + 1];
		if (newExp >= lvUpExp) {
			if (lv == lvLimit) {
				newExp = lvUpExp;
				break;
			} else {
				++lv;
				newExp -= lvUpExp;
			}
		} else {
			break;
		}
	}

	return [lv, newExp];
}

Util.prototype.randomIntBetween = function (min, max) {
	  return Math.floor(Math.random() * (max - min)) + min;
}

module.exports = new Util;
