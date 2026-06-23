function toAsciiUpper(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function abbreviateTeamName(name) {
  const value = String(name || '').trim();

  if (/^\d/.test(value) || /^[A-Za-z]\d+$/.test(value) || value.length <= 3) {
    return value;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    return toAsciiUpper(words.slice(0, 3).map((word) => word[0]).join(''));
  }

  if (words.length === 2) {
    return toAsciiUpper(words[0].slice(0, 2) + words[1][0]);
  }

  return toAsciiUpper(value.slice(0, 3));
}

module.exports = { abbreviateTeamName };
