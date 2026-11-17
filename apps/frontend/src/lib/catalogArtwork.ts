import type { Dish, RestaurantSummary } from '@uzbite/shared';

// Artwork supplied by the user for the bundled fictional catalog only.
// Restaurants and dishes outside these sample IDs retain their own images.
const sampleInteriors: Record<string, string> = {
  'rest-basilico': 'interior-chorsu.jpg',
  'rest-burger': 'interior-tandir.jpg',
  'rest-mori': 'interior-samarqand.jpg',
  'rest-non': 'interior-tandir.jpg',
  'rest-osh': 'interior-chorsu.jpg',
  'rest-saffron': 'interior-samarqand.jpg',
};
const sampleDishes: Record<string, string> = { 'dish-plov': 'plov.jpg', 'dish-samsa': 'samsa.jpg' };

export function restaurantArtwork(restaurant: Pick<RestaurantSummary, 'id' | 'coverUrl' | 'galleryUrls'>, cover = false) {
  if (restaurant.galleryUrls?.length) return restaurant.galleryUrls[0];
  const image = sampleInteriors[restaurant.id];
  return image ? '/images/uzbite/' + (cover && restaurant.id === 'rest-osh' ? 'restaurant-cover.jpg' : image) : restaurant.coverUrl;
}

export function restaurantPhotos(restaurant: Pick<RestaurantSummary, 'id' | 'coverUrl' | 'galleryUrls'>) {
  return [...new Set([restaurantArtwork(restaurant, true), ...(restaurant.galleryUrls ?? [])].filter(Boolean))];
}

export function dishArtwork(dish: Pick<Dish, 'id' | 'imageUrl'>) {
  return sampleDishes[dish.id] ? '/images/uzbite/' + sampleDishes[dish.id] : dish.imageUrl;
}
