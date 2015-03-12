function VIP () {
}

VIP.prototype.daily = function (pay) {
	if (pay < 1) {
		return 0;
	} else if (pay < 100) {
		return 1;
	} else if (pay < 2000) {
		return 2;
	} else if (pay < 10000) {
		return 3;
	} else {
		return 4;
	}
}

VIP.prototype.total = function (pay) {
	if (pay < 1) {
		return 0;
	} else if (pay < 2000) {
		return 1;
	} else if (pay < 10000) {
		return 2;
	} else if (pay < 50000) {
		return 3;
	} else {
		return 4;
	}
}

module.exports = new VIP();
