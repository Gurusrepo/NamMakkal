
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createComplaint } from '../../api/complaints.js';
import { getApiErrorMessage } from '../../api/errors.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function validatePhoto(file) {
  if (!file) return '';
  if (!allowedTypes.has(file.type)) return 'Photo must be a JPEG, PNG, or WebP image.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 5 MB or smaller.';
  return '';
}

function formatAddress(address = {}) {
  const parts = [
    address.road,
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.city || address.town || address.village,
    address.state,
    address.country
  ];

  return [...new Set(parts.filter(Boolean))].join(', ');
}

export default function ReportComplaint() {
  const navigate = useNavigate();
  const geocodeRequestId = useRef(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [accuracy, setAccuracy] = useState('');
  const [address, setAddress] = useState('');
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');

  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [locationMessage, setLocationMessage] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitStage, setSubmitStage] = useState('');
  const [uploadPercent, setUploadPercent] = useState(null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl('');
      return undefined;
    }

    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handlePhotoChange(event) {
    const selected = event.target.files?.[0] ?? null;
    const validationError = selected ? validatePhoto(selected) : '';

    setPhotoError(validationError);
    setPhoto(validationError ? null : selected);
  }


  async function lookupAddress(lat, lon) {
    const requestId = ++geocodeRequestId.current;

    setIsResolvingAddress(true);
    setAddressError('');
    setAddress('');

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lon),
        addressdetails: '1',
        'accept-language': 'en'
      });

      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error('Address lookup failed.');
      }

      const data = await response.json();

      if (requestId !== geocodeRequestId.current) return;

      const readableAddress = formatAddress(data.address);

      if (readableAddress) {
        setAddress(readableAddress);
      } else if (data.display_name) {
        setAddress(data.display_name);
      } else {
        setAddressError('No readable address was found for this location.');
      }
    } catch {
      if (requestId === geocodeRequestId.current) {
        setAddressError('Could not fetch the address. Your coordinates are still available.');
      }
    } finally {
      if (requestId === geocodeRequestId.current) {
        setIsResolvingAddress(false);
      }
    }
  }

  function handleCoordinateBlur() {
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (
      latitude.trim() === '' ||
      longitude.trim() === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return;
    }

    void lookupAddress(lat, lon);
  }

  function useCurrentLocation() {
    setLocationMessage('');
    setAddress('');
    setAddressError('');

    if (!navigator.geolocation) {
      setLocationMessage(
        'This browser does not provide location services. Enter the coordinates manually.'
      );
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude;
        const lon = coords.longitude;

        setLatitude(String(lat));
        setLongitude(String(lon));

        setAccuracy(
          Number.isFinite(coords.accuracy) &&
          coords.accuracy > 0 &&
          coords.accuracy <= 100000
            ? String(coords.accuracy)
            : ''
        );

        setLocationMessage('Current location detected successfully.');
        setIsLocating(false);

        void lookupAddress(lat, lon);
      },
      (error) => {
        const messages = {
          1: 'Location permission was denied. Enter the coordinates manually.',
          2: 'Your location could not be determined. Enter the coordinates manually.',
          3: 'Location request timed out. Try again or enter coordinates manually.'
        };

        setLocationMessage(
          messages[error.code] ??
          'Location could not be determined. Enter the coordinates manually.'
        );

        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage('');

    const numericLatitude = Number(latitude);
    const numericLongitude = Number(longitude);

    if (title.trim().length < 3 || title.trim().length > 160) {
      setErrorMessage('Enter a title between 3 and 160 characters.');
      return;
    }

    if (description.trim().length < 10 || description.trim().length > 5000) {
      setErrorMessage('Enter a description between 10 and 5000 characters.');
      return;
    }

    if (
      !Number.isFinite(numericLatitude) ||
      numericLatitude < -90 ||
      numericLatitude > 90
    ) {
      setErrorMessage('Enter a valid latitude between -90 and 90.');
      return;
    }

    if (
      !Number.isFinite(numericLongitude) ||
      numericLongitude < -180 ||
      numericLongitude > 180
    ) {
      setErrorMessage('Enter a valid longitude between -180 and 180.');
      return;
    }

    const validationError = validatePhoto(photo);

    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    setIsSubmitting(true);
    setSubmitStage('validating');
    setUploadPercent(photo ? 0 : null);

    try {
      setSubmitStage(photo ? 'uploading' : 'submitting');
      const result = await createComplaint({
        title: title.trim(),
        description: description.trim(),
        address: address.trim(),
        latitude: numericLatitude,
        longitude: numericLongitude,
        location_accuracy_meters: accuracy || undefined,
        photo,
        onUploadProgress: photo ? (event) => {
          if (typeof event.loaded !== 'number' || !event.total) return;
          setUploadPercent(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        } : undefined
      });
      setSubmitStage('confirmed');

      navigate(`/citizen/complaints/${result.complaint.id}`, {
        replace: true
      });
    } catch (error) {
      setErrorMessage(
        getApiErrorMessage(error, 'We could not submit your complaint. Please try again.')
      );
    } finally {
      setIsSubmitting(false);
      setSubmitStage('');
    }
  }

  const hasValidCoordinates =
    latitude.trim() !== '' &&
    longitude.trim() !== '' &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180;

  const mapUrl = hasValidCoordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(longitude) - 0.005}%2C${Number(latitude) - 0.005}%2C${Number(longitude) + 0.005}%2C${Number(latitude) + 0.005}&layer=mapnik&marker=${latitude}%2C${longitude}`
    : '';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="mt-5 text-xl font-semibold uppercase tracking-[0.16em] text-[#9a7832]">
          Make your neighbourhood better
        </p>

        <p className="mt-2 text-sm leading-6 text-[#68736a]">
          Add clear details, where the issue is, and a photo. Your report will be linked to your account.
        </p>
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-[#e9c9c2] bg-[#fff5f2] px-4 py-3 text-sm text-[#8b3c2d]"
        >
          {errorMessage}
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
        className="space-y-6 rounded-2xl border border-[#e5e2d5] bg-white p-5 shadow-sm sm:p-8"
      >
        {isSubmitting && (
          <section aria-label="Complaint submission progress" className="rounded-xl border border-[#d9e3d6] bg-[#f7faf5] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#68736a]">Submission progress</p>
            <ol className="mt-3 space-y-2 text-sm">
              <li className="flex items-center gap-2 text-[#1d4933]"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#477454]" /> Validating complaint details — complete</li>
              {photo && (
                <li className="flex items-center gap-2 text-[#526258]">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${uploadPercent === 100 ? 'bg-[#477454]' : 'bg-[#d4ae58]'}`} />
                  {uploadPercent === 100 ? 'Uploading evidence — complete' : `Uploading evidence${uploadPercent !== null ? ` — ${uploadPercent}%` : ' — in progress'}`}
                </li>
              )}
              <li className="text-[#526258]">{submitStage === 'submitting' ? 'Submitting complaint to the server — in progress' : submitStage === 'confirmed' ? 'Submitting complaint to the server — complete' : 'Waiting to submit complaint to the server'}</li>
              {submitStage === 'confirmed' && <li className="font-semibold text-[#1d4933]">Complaint confirmation received</li>}
            </ol>
            {photo && uploadPercent !== null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dfe7dc]" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadPercent}>
                <div className="h-full rounded-full bg-[#477454] transition-[width] motion-reduce:transition-none" style={{ width: `${uploadPercent}%` }} />
              </div>
            )}
          </section>
        )}
        <div>
          <label
            htmlFor="complaint-title"
            className="mb-2 block text-sm font-semibold text-[#34483a]"
          >
            Complaint title
          </label>

          <input
            id="complaint-title"
            name="title"
            required
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example, damaged road near the bus stop"
            className="min-h-12 w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
          />

          <p className="mt-1 text-right text-xs text-[#758077]">
            {title.length}/160
          </p>
        </div>

        <div>
          <label
            htmlFor="complaint-address"
            className="mb-2 block text-sm font-semibold text-[#34483a]"
          >
            Complaint address
          </label>

          <input
              id="complaint-address"
              name="address"
              type="text"
              required
              minLength={5}
              maxLength={300}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Enter the complete complaint address"
              className="min-h-12 w-full rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm text-[#24362a] outline-none placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
          />

        </div>


        <div>
          <label
            htmlFor="complaint-description"
            className="mb-2 block text-sm font-semibold text-[#34483a]"
          >
            Detailed description
          </label>

          <textarea
            id="complaint-description"
            name="description"
            required
            minLength={10}
            maxLength={5000}
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe what happened, how long it has been present, and who may be affected."
            className="w-full resize-y rounded-xl border border-[#d9ded5] bg-white px-4 py-3 text-sm leading-6 text-[#24362a] outline-none placeholder:text-[#9aa39b] focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
          />

          <p className="mt-1 text-right text-xs text-[#758077]">
            {description.length}/5000
          </p>
        </div>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-[#34483a]">
            Issue location
          </legend>

          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={isLocating}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#cfd8ce] bg-[#f7faf5] px-4 text-sm font-semibold text-[#1d4933] transition hover:bg-[#edf2eb] focus:outline-none focus:ring-4 focus:ring-[#477454]/20 disabled:cursor-wait disabled:opacity-60"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
            >
              <path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>

            {isLocating ? 'Finding your location...' : 'Use my current location'}
          </button>

          {locationMessage && (
            <p role="status" className="text-sm text-[#526a58]">
              {locationMessage}
            </p>
          )}

          <p className="text-xs leading-5 text-[#758077]">
            You can also enter coordinates manually. Coordinates are used to locate the report on the civic map.
          </p>

          {/* Location preview card */}
          {hasValidCoordinates && (
            <div className="overflow-hidden rounded-2xl border border-[#b9d7bd] bg-[#f6faf5]">
              <div className="grid sm:grid-cols-[minmax(0,1fr)_1.35fr]">
                <div className="relative min-h-48 bg-[#e9eee8] sm:min-h-52">
                  <iframe
                    title="Map showing the complaint location"
                    src={mapUrl}
                    className="absolute inset-0 h-full w-full border-0"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="flex flex-col justify-center gap-3 p-4 sm:p-5">
                  <div className="flex items-start gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="mt-0.5 h-5 w-5 shrink-0 text-[#1d4933]"
                    >
                      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>

                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold leading-6 text-[#20382a]">
                        {isResolvingAddress
                          ? 'Finding your address...'
                          : address || 'Location coordinates detected'}
                      </h3>

                      <p className="mt-1 text-xs leading-5 text-[#68736a]">
                        {isResolvingAddress
                          ? 'Converting coordinates into a readable address.'
                          : addressError || 'Complaint location'}
                      </p>
                    </div>
                  </div>

                  <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#e1f2df] px-3 py-1.5 text-xs font-semibold text-[#205b35]">
                    <span className="h-2 w-2 rounded-full bg-[#278447]" />
                    {address
                      ? 'Location detected'
                      : 'Coordinates available'}
                  </div>

                  {accuracy && (
                    <p className="flex items-center gap-2 text-xs text-[#68736a]">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                      </svg>
                      Accuracy: approximately {Math.round(Number(accuracy))} metres
                    </p>
                  )}

                  {addressError && (
                    <button
                      type="button"
                      onClick={() => lookupAddress(Number(latitude), Number(longitude))}
                      className="w-fit text-xs font-semibold text-[#1d4933] underline underline-offset-4"
                    >
                      Try address lookup again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="complaint-latitude"
                className="mb-2 block text-sm font-medium text-[#34483a]"
              >
                Latitude
              </label>

              <input
                id="complaint-latitude"
                name="latitude"
                type="number"
                inputMode="decimal"
                step="any"
                min="-90"
                max="90"
                required
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                onBlur={handleCoordinateBlur}
                placeholder="e.g. 11.2189"
                className="min-h-12 w-full rounded-xl border border-[#d9ded5] px-4 py-3 text-sm outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
              />
            </div>

            <div>
              <label
                htmlFor="complaint-longitude"
                className="mb-2 block text-sm font-medium text-[#34483a]"
              >
                Longitude
              </label>

              <input
                id="complaint-longitude"
                name="longitude"
                type="number"
                inputMode="decimal"
                step="any"
                min="-180"
                max="180"
                required
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                onBlur={handleCoordinateBlur}
                placeholder="e.g. 78.1650"
                className="min-h-12 w-full rounded-xl border border-[#d9ded5] px-4 py-3 text-sm outline-none focus:border-[#477454] focus:ring-4 focus:ring-[#477454]/10"
              />
            </div>
          </div>

          {accuracy && (
            <p className="text-xs text-[#68736a]">
              Location accuracy: approximately {Math.round(Number(accuracy))} metres.
            </p>
          )}
        </fieldset>

        <div>
          <label
            htmlFor="complaint-photo"
            className="mb-2 block text-sm font-semibold text-[#34483a]"
          >
            Photo of the issue
          </label>

          <input
            id="complaint-photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={handlePhotoChange}
            aria-describedby="photo-hint photo-error"
            className="block min-h-12 w-full rounded-xl border border-[#d9ded5] bg-white text-sm text-[#34483a] file:mr-4 file:min-h-12 file:border-0 file:bg-[#edf2eb] file:px-4 file:font-semibold file:text-[#1d4933] focus:outline-none focus:ring-4 focus:ring-[#477454]/10"
          />

          <p id="photo-hint" className="mt-2 text-xs text-[#758077]">
            JPEG, PNG, or WebP. Maximum file size 5 MB.
          </p>

          {photoError && (
            <p id="photo-error" role="alert" className="mt-2 text-sm text-[#8b3c2d]">
              {photoError}
            </p>
          )}

          {previewUrl && (
            <figure className="mt-4 overflow-hidden rounded-xl border border-[#e5e2d5] bg-[#f7f6ef] p-2">
              <img
                src={previewUrl}
                alt="Preview of the selected complaint photo"
                className="max-h-80 w-full rounded-lg object-contain"
              />
              <figcaption className="px-2 py-2 text-xs text-[#68736a]">
                {photo?.name}
              </figcaption>
            </figure>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-[#edf0e9] pt-5 sm:flex-row sm:justify-end">
          <Link
            to="/citizen"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#cfd8ce] px-5 text-sm font-semibold text-[#425348] hover:bg-[#f7f8f5] focus:outline-none focus:ring-4 focus:ring-[#477454]/20"
          >
            Cancel
          </Link>

          <button
            type="submit"
            disabled={isSubmitting || Boolean(photoError)}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#1d4933] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#163b29] focus:outline-none focus:ring-4 focus:ring-[#477454]/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <><span aria-hidden="true" className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white motion-reduce:animate-none" />Submitting complaint...</>
            ) : 'Submit complaint'}
          </button>
        </div>
      </form>
    </div>
  );
}
