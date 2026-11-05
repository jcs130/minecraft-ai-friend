// The native goddess camera uses this fixed LoginGuard identity. Match the
// name too because lifecycle records and older projections may omit the UUID.
export const photoObserverName = 'ag_photolens';
const photoObserverUuid = 'ff58a81b-f033-3b74-a7cf-58ac4e798bb0';
export const isPhotoObserver = (name, uuid) => (typeof name === 'string' && name.toLowerCase() === photoObserverName)
  || (typeof uuid === 'string' && uuid.toLowerCase() === photoObserverUuid);
