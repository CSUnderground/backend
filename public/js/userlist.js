const times = [
  60000,
  3.6e+6,
  8.64e+7,
  6.048e+8,
  2.628e+9,
  3.154e+10,
];

function constructTimeString(unit, singularString, timeIndex, time) {
  // NOTE: we do timeIndex - 1 because the array is offset in timeFunctions.
  if (time >= 2 * times[timeIndex - 1]) {
    return `${Math.floor(time / times[timeIndex - 1])} ${unit}s ago`;
  } else {
    return singularString;
  }
}

const timeFunctions = [
  () => 'just now',
  constructTimeString.bind(null, 'minute', 'a minute ago', 1),
  constructTimeString.bind(null, 'hour', 'an hour ago', 2),
  constructTimeString.bind(null, 'day', '1 day ago', 3),
  constructTimeString.bind(null, 'week', '1 week ago', 4),
  constructTimeString.bind(null, 'month', '1 month ago', 5),
  constructTimeString.bind(null, 'year', '1 year ago', 6),
];

// We include our own binary search because we have more control over how 
// the index is picked.
function binarySearchInsert(array, value) {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = low + high >>> 1;
    if (array[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function epochAgo(timeStamp) {
  const timeDifference = Date.now() - timeStamp;
  const index = binarySearchInsert(times, timeDifference);
  const timeAgo = timeFunctions[index](timeDifference);
  return timeAgo;
}

function sterilize(str){
	if(!str) return "UNDEFINED"
	return str.toString().replace(/</g,"&lt;").replace(/>/g,"&gt;")
}
function generateUserCard(user) {
	return '<div class="program-card"> <div class="card"> <p class="card-text title"><a href="/profile/' + user.username + '">' + sterilize(user.displayName) + '</a></p> <p class="card-text creator" style="overflow:initial"><a href="/profile/' + user.username + '">@' + user.username  + '</a></p> <p class="card-text stats" title="EPOCH: ' + user.accountCreation + '">Created ' + epochAgo(user.accountCreation) + '</p> </div> </div>';
}