/*
 * The row of counts at the top right (the star hunt's, testnet $CHOG): beside the map on a laptop, above it
 * on a phone, out of the way of your Chog's panel, the map and the zoom (the user, 10-23: "move above").
 */
export function hudRow() {
  let row = document.getElementById('pl-row');
  if (!row) {
    row = document.createElement('div');
    row.id = 'pl-row';
    row.className = 'pl-row';
    document.body.append(row);
  }
  return row;
}
