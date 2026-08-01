const GIFT_CATALOG = [
  {
    id: 'rose',
    name: 'Rose',
    category: 'Flowers',
    coins: 1200,
    emoji: '🌹',
    blurb: 'Classic rose',
  },
  {
    id: 'flower',
    name: 'Flower',
    category: 'Flowers',
    coins: 200,
    emoji: '🌸',
    blurb: 'Soft blossom',
  },
  {
    id: 'bouquet',
    name: 'Rose Bouquet',
    category: 'Flowers',
    coins: 1500,
    emoji: '💐',
    blurb: 'Cinematic animation',
  },
  {
    id: 'heart',
    name: 'Heart',
    category: 'Romantic',
    coins: 300,
    emoji: '❤️',
    blurb: 'Sweet gesture',
  },
  {
    id: 'chocolate',
    name: 'Chocolate',
    category: 'Romantic',
    coins: 500,
    emoji: '🍫',
    blurb: 'Sweet treat',
  },
  {
    id: 'teddy',
    name: 'Teddy',
    category: 'Romantic',
    coins: 800,
    emoji: '🧸',
    blurb: 'Cute companion',
  },
  {
    id: 'crown',
    name: 'Crown',
    category: 'Luxury',
    coins: 5000,
    emoji: '👑',
    blurb: 'Royal vibes',
  },
  {
    id: 'car',
    name: 'Luxury Car',
    category: 'Luxury',
    coins: 20000,
    emoji: '🚗',
    blurb: 'Showstopper',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    category: 'VIP',
    coins: 10000,
    emoji: '💎',
    blurb: 'VIP exclusive',
  },
  {
    id: 'ring',
    name: 'Ring',
    category: 'VIP',
    coins: 8000,
    emoji: '💍',
    blurb: 'VIP exclusive',
  },
];

const GIFT_CATEGORIES = ['Flowers', 'Romantic', 'Luxury', 'VIP'];

function getGiftById(id) {
  return GIFT_CATALOG.find(item => item.id === String(id || '').trim()) || null;
}

module.exports = {
  GIFT_CATALOG,
  GIFT_CATEGORIES,
  getGiftById,
};
