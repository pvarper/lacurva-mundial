function abbreviateTeamName(name) {
  const value = String(name || '').trim();

  if (/^\d/.test(value) || /^[A-Za-z]\d+$/.test(value) || value.length <= 3) {
    return value;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.slice(0, 3).map((word) => word[0]).join('').toUpperCase();
  }

  return value.slice(0, 3).toUpperCase();
}

module.exports = { abbreviateTeamName };
