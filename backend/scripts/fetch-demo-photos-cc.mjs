#!/usr/bin/env node
/**
 * Openly-licensed photos for the demo items Open Food Facts can't serve —
 * hardware, garden, electronics, apparel, toys… (the food database has no
 * cordless drills, which is why the Home Depot example and Walmart's
 * general-merchandise wing had no photos at all).
 *
 *   node backend/scripts/fetch-demo-photos-cc.mjs                  # fill every gap (idempotent)
 *   node backend/scripts/fetch-demo-photos-cc.mjs --only "Nail Gun 16ga,Duct Tape 50m"
 *   node backend/scripts/fetch-demo-photos-cc.mjs --force          # re-pick items that already have a photo
 *   node backend/scripts/fetch-demo-photos-cc.mjs --retry          # re-try items that fell back to a packshot
 *   node backend/scripts/fetch-demo-photos-cc.mjs --retry-weak     # re-pick photos that only just cleared the bar
 *   node backend/scripts/fetch-demo-photos-cc.mjs --leftovers       # also take over grocery items the food
 *                                                               # database couldn't serve (fetch-demo-photos.mjs)
 *
 * Sources, in order: Openverse (CC-licensed, commercial + modification
 * allowed) and Wikimedia Commons (same licence rule). Only photos whose title
 * matches the item are considered, then each candidate is scored on how
 * product-shot-like it is — flat backdrop, product filling the frame
 * (backend/scripts/packshot.py, needs Pillow) — and the best one is kept,
 * cropped to the product. The pick + its credit live in demo-photos-cc.json,
 * are written to ATTRIBUTION-CC.md, and demo-photos.json gets the url mapping.
 * An item with no usable photo falls back to a generated packshot.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, writePackshotSvg } from './packshot-svg.mjs';
import { CORNER_STORE, ORIGINAL, WALMART } from './demo-photo-wanted.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../demo-products');
const MANIFEST = path.join(here, 'demo-photos-cc.json');
const PHOTO_MAP = path.join(here, 'demo-photos.json');
const CREDITS = path.join(OUT, 'ATTRIBUTION-CC.md');
const STATE = path.join(os.tmpdir(), 'storemap-fetch-demo-photos-cc.json');
const UA = 'StoreMap-demo-seeder/1.0 (https://github.com/eman101101/storemaplocal; demo photo fetcher; node)';
const PACKSHOT = path.join(here, 'packshot.py');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};

/* ══════════════════════════════════════════════════════════════════════════
   What to find. Names are the seeders' base product names (the key
   demo-photos.json is keyed by). Search terms come from the name; the
   TERMS overrides hand-tune the ones the rule gets wrong.
   ══════════════════════════════════════════════════════════════════════════ */
const HOME_DEPOT = [
  'Cordless Drill Kit 18V', 'Circular Saw 185mm', 'Impact Driver 18V', 'Oscillating Multi-Tool', 'Angle Grinder 115mm',
  'Reciprocating Saw', 'Rotary Hammer SDS', 'Belt Sander 75mm', 'Orbital Sander 125mm', 'Nail Gun 16ga',
  'Claw Hammer 16oz', 'Screwdriver Set 12pc', 'Adjustable Wrench 250mm', 'Pliers Set 3pc', 'Tape Measure 8m',
  'Utility Knife', 'Spirit Level 600mm', 'Socket Set 40pc', 'Hex Key Set Metric', 'Stud Finder',
  'Interior Paint 5L Eggshell', 'Exterior Paint 5L Satin', 'Primer Undercoat 3.8L', 'Wood Stain 946ml',
  'Roller Frame 230mm', 'Roller Covers 3pc', 'Brush Set 3pc', 'Painter Tape 50m', 'Drop Cloth 3.6×2.7m', 'Paint Tray Kit',
  'Stud 45×90×2400mm', 'Plywood Sheet 18mm', 'MDF Board 12mm', 'Decking Board 3600mm', 'Fence Panel 1800mm',
  'Dado Rail 2400mm', 'Architrave Set 2400mm', 'OSB Sheet 11mm', 'Plasterboard 12.5mm', 'Cedar Post 2400mm',
  'PVC Pipe 32mm 3m', 'Copper Pipe 15mm 2m', 'Pipe Elbow 32mm', 'Ball Valve 15mm', 'Tap Washer Assortment',
  'Bottle Trap 40mm', 'Toilet Fill Valve', 'Rain Shower Head', 'Hose Bib 20mm', 'Pipe Wrench 350mm',
  'Twin & Earth Cable 10m', 'Conduit 20mm 2m', 'Double Socket Outlet', 'Light Switch Plate', 'Junction Box IP65',
  'Circuit Breaker 20A', 'LED Downlight 9W', 'Wireless Doorbell Kit', 'Extension Reel 25m', 'Digital Multimeter',
  'LED Shop Light 1.2m', 'Pendant Lamp Kit', 'Ceiling Fan 1200mm', 'Track Light 3-head', 'Under-Cabinet Strip 600mm',
  'Motion Sensor Light', 'Portable Work Light 20W', 'Smart Bulb 2-pack', 'Flood Light 30W', 'Vanity Bar 4-light',
  'Dishwasher 600mm', 'Refrigerator 500L', 'Washer 8kg', 'Dryer 7kg', 'Rangehood 600mm', 'Electric Oven 600mm',
  'Induction Cooktop 4-zone', 'Microwave 30L', 'Chest Freezer 200L', 'Portable AC 9000BTU',
  'Wood Screws 4×40 200pc', 'Masonry Anchors 100pc', 'Cabinet Hinge Pair', 'Door Handle Set', 'Hasp & Staple 150mm',
  'Padlock 50mm', 'Drawer Slides Pair', 'Gate Hinge Set', 'Turnbuckle M8', 'Eye Bolt M8 4pc',
  'Steel Shelving 5-tier', 'Plastic Tote 45L', 'Tool Box 480mm', 'Stackable Bin 4-pack', 'Garage Cabinet Steel',
  'Pegboard 600×900', 'Crate 60L Foldable', 'Ceiling Storage Rack',
  'Garden Hose 20m', 'Oscillating Sprinkler', 'Petrol Lawn Mower', 'Hedge Trimmer 550mm', 'Potting Mix 40L',
  'Planter Pot 300mm', 'Garden Trowel', 'Pruning Shears', 'Wheelbarrow 90L', 'Grass Seed 2kg',
  'Gas BBQ 4-Burner', 'Charcoal Kettle 570mm', 'Electric Smoker', 'BBQ Tool Set 3pc', 'Propane Tank 9kg',
  'Outdoor Pizza Oven', 'Steel Fire Pit', 'Gas Patio Heater', 'Rotomold Cooler 28L', 'Gazebo 3×3m',
  'Cement Bag 25kg', 'Mortar Mix 20kg', 'Concrete Mix 20kg', 'Post Crete 20kg', 'Self-Levelling Compound 20kg',
  'Paver Base Sand 20kg', 'Render Mix 20kg', 'Crack Filler 1L',
  'Corrugated Sheet 2400mm', 'Ridge Cap Steel', 'Gutter 3m', 'Downpipe 2m', 'Gutter Brackets 10pc',
  'Roofing Screws 100pc', 'Roof Felt 10m Roll', 'Soffit Vent 100mm',
  'Laminate Planks 2.2m²', 'Vinyl Roll 3m', 'Engineered Oak 1.5m²', 'Tile Backer Board', 'Floor Underlay 10m²',
  'Carpet Tiles 20pc', 'Floor Scraper 200mm', 'Skirting 2400mm',
  'Hard Hat', 'Safety Goggles', 'Leather Work Gloves', 'Hi-Vis Vest', 'Ear Defenders', 'Dust Mask FFP2 5pc',
  'Steel Toe Boots', 'Gel Knee Pads', 'First Aid Kit 60pc', 'Fall Arrest Harness',
  'Interior Door 800mm', 'Exterior Door 900mm', 'Door Frame Kit', 'Window 900×600', 'Screen Door 800mm',
  'Door Closer', 'Threshold Strip 900mm', 'Weather Strip Roll',
  'Sink Mixer Chrome', 'Vanity Basin 600mm', 'Pull-out Kitchen Tap', 'Towel Rail Chrome', 'Shower Screen 900mm',
  'Bath Panel 1700mm', 'Close-Coupled WC', 'Cabinet Pulls 10pc',
  'Fairy Lights 20m', 'Christmas Tree 180cm', 'Halloween Pumpkin Decor', 'Snow Shovel', 'De-Icer Salt 10kg',
  'Leaf Blower', 'Gazebo Side Panel', 'Advent Calendar',
];

/** Walmart's general-merchandise wing (non-food only — food comes from the
 *  Open Food Facts script; WALMART imported below is its grocery list). */
const WALMART_GENERAL = [
  'Acrylic Paint Set', 'Action Figure 30cm', 'Advent Calendar', 'Aquarium Filter', 'Baby Bottle 2-pack',
  'Baby Onesies 5-pack', 'Baby Sleep Sack', 'Bandages 100pc', 'Basketball Size 7', 'Beach Towel 2-pack',
  'Beads Assortment 2000pc', 'Bed Sheet Set Queen', 'Bestseller Novel', 'Bike Helmet Adult', 'Birthday Balloons 20pc',
  'Birthday Candles 24pc', 'Blackout Curtains 2pc', 'Bluetooth Speaker', 'Board Game Classic', 'Boys Hoodie',
  'Boys Jeans', 'Boys Pajama Set', 'Boys Shorts 2-pack', 'Boys Sneakers', 'Boys Tee 3-pack', 'Brush Set 10pc',
  'Building Bricks 500pc', 'Calendar 2027', 'Camping Chair', 'Canvas 40×50 2-pack', 'Car Air Freshener',
  'Car Charger 2-port', 'Car Wash Shampoo 2L', 'Car Wax 500ml', 'Card Game Deck', 'Cat Tree Tower', 'Charcoal 5kg',
  'Christmas Wreath 40cm', 'Claw Hammer 16oz', 'Coffee Maker 12-cup', 'Confetti 3-pack', 'Cookbook Hardcover',
  'Coolant 50/50 4L', 'Cordless Drill 18V', 'Cutlery Set 24pc', 'Cutting Board Bamboo', 'Desk Lamp LED',
  'Desk Organizer', 'Dinner Set 16pc', 'Dog Chew Toy', 'Door Wreath Hanger', 'Duct Tape 50m', 'Dumbbell Set 20kg',
  'Duvet Cover Queen', 'Easter Basket', 'Fairy Lights 20m', 'First Aid Kit 60pc', 'Floor Mats 4pc',
  'Food Containers 10pc', 'Frying Pan 28cm', 'Garden Hose 20m', 'Garden Trowel', 'Gel Pens 12-pack',
  'Gift Wrap Roll 30m', 'Girls Dress', 'Girls Hoodie', 'Girls Leggings 2-pack', 'Girls Pajama Set', 'Girls Sneakers',
  'Girls Tee 3-pack', 'Glue Gun + Sticks', 'Greeting Cards 8pc', 'Halloween Pumpkin Decor', 'HDMI Cable 2m',
  'Hiking Boots', 'Ice Scraper', 'Journal Notebook', 'Jump Starter 600A', 'Kettle 1.7L', 'Kids Light-up Sneakers',
  'Kids Storybook', "Ladies' Blouse", "Ladies' Cardigan", "Ladies' Jeans", "Ladies' Leggings", "Ladies' Scarf",
  "Ladies' Tee 3-pack", 'Laptop 15"', 'Laundry Basket Foldable', 'Lawn Seed 2kg', 'Magazine Special',
  'Mattress Topper Queen', "Men's Belt Leather", "Men's Chinos", "Men's Hoodie", "Men's Jeans", "Men's Polo",
  "Men's Tee 3-pack", 'Mixing Bowls 5pc', 'Motor Oil 5W-30 5L', 'Notebook 3-pack', 'Number Balloon 90cm',
  'Office Chair Mesh', 'Origami Paper 200pc', 'Paper Ream 500 Sheets', 'Party Bags 10pc', 'Party Banner',
  'Patio Chair Foldable', 'Pet Bowl Set', 'Phone Car Mount', 'Picture Hooks 50-pack', 'Pillows 2-pack',
  'Planter Pot 30cm', 'Plush Bear 40cm', 'Poster Print 60×90', 'Power Bank 20000mAh', 'Puzzle 1000pc',
  'Race Track Set', 'RC Car 1:16', 'Resistance Bands 5-pack', 'Roof Cargo Box', 'Running Shoes', 'Sandals Pair',
  'Scrapbook Kit', 'Screwdriver Set 12pc', 'Seat Covers 2pc', 'Sleeping Bag', 'Slippers Fleece', 'Smart TV 50"',
  'Smart Watch', 'Sneakers Unisex 42', 'Stapler Heavy Duty', 'Sticky Notes 12-pack', 'Storage Bins 6-pack',
  'String Lights 10m', 'Sunshade UV 50', 'Tablet 10"', 'Tape Measure 8m', 'Tent 4-Person', 'Throw Blanket Soft',
  'Tire Inflator 12V', 'Tow Rope 4t', 'Travel Guide', 'Trunk Organizer', 'Utility Knife', 'Wall Anchors 100-pack',
  'Watering Can 10L', 'Wiper Blades Pair', 'Wireless Earbuds', 'Yarn 4-pack', 'Yoga Mat 6mm',
  // non-food items sitting in food departments
  'Lighter', 'Phone Charging Cable', 'Bird Seed 3kg', 'Diapers Size 4 44pc',
];

/** name → search term, where the name alone searches badly. */
const TERMS = {
  'Oscillating Multi-Tool': 'oscillating tool',
  'Rotary Hammer SDS': 'rotary hammer drill',
  'Nail Gun 16ga': 'nail gun',
  'Pliers Set 3pc': 'pliers',
  'Socket Set 40pc': 'socket wrench set',
  'Hex Key Set Metric': 'allen keys',
  'Interior Paint 5L Eggshell': 'paint can',
  'Exterior Paint 5L Satin': 'paint bucket',
  'Primer Undercoat 3.8L': 'paint can white',
  'Wood Stain 946ml': 'wood stain can',
  'Roller Frame 230mm': 'paint roller',
  'Roller Covers 3pc': 'paint roller covers',
  'Brush Set 3pc': 'paint brushes',
  'Painter Tape 50m': 'masking tape',
  'Stud 45×90×2400mm': 'wood stud',
  'Plasterboard 12.5mm': 'drywall sheet',
  'Cedar Post 2400mm': 'wooden post',
  'Pipe Elbow 32mm': 'PVC elbow fitting',
  'Tap Washer Assortment': 'tap washers',
  'Bottle Trap 40mm': 'sink drain trap',
  'Hose Bib 20mm': 'garden tap',
  'Twin & Earth Cable 10m': 'electrical cable',
  'Conduit 20mm 2m': 'electrical conduit',
  'Double Socket Outlet': 'electrical outlet',
  'Junction Box IP65': 'electrical junction box',
  'Extension Reel 25m': 'extension cord reel',
  'LED Shop Light 1.2m': 'LED tube light',
  'Pendant Lamp Kit': 'pendant lamp',
  'Track Light 3-head': 'track lighting',
  'Under-Cabinet Strip 600mm': 'under cabinet lighting',
  'Portable Work Light 20W': 'work light',
  'Vanity Bar 4-light': 'bathroom light fixture',
  'Washer 8kg': 'washing machine',
  'Dryer 7kg': 'clothes dryer',
  'Rangehood 600mm': 'range hood',
  'Electric Oven 600mm': 'kitchen stove',
  'Portable AC 9000BTU': 'portable air conditioner',
  'Masonry Anchors 100pc': 'concrete anchors',
  'Hasp & Staple 150mm': 'padlock hasp',
  'Steel Shelving 5-tier': 'metal shelving unit',
  'Plastic Tote 45L': 'storage tote',
  'Tool Box 480mm': 'toolbox',
  'Stackable Bin 4-pack': 'stackable storage bins',
  'Garage Cabinet Steel': 'metal cabinet',
  'Crate 60L Foldable': 'folding crate',
  'Ceiling Storage Rack': 'garage storage rack',
  'Petrol Lawn Mower': 'lawn mower',
  'Potting Mix 40L': 'potting soil bag',
  'Planter Pot 300mm': 'flower pot',
  'Gas BBQ 4-Burner': 'gas grill',
  'Charcoal Kettle 570mm': 'kettle grill',
  'BBQ Tool Set 3pc': 'grill tools',
  'Rotomold Cooler 28L': 'ice chest',
  'Gazebo 3×3m': 'pop up canopy',
  'Mortar Mix 20kg': 'cement bag',
  'Concrete Mix 20kg': 'concrete bag',
  'Post Crete 20kg': 'concrete mix',
  'Self-Levelling Compound 20kg': 'self leveling compound',
  'Paver Base Sand 20kg': 'bag of sand',
  'Render Mix 20kg': 'cement render',
  'Crack Filler 1L': 'caulk tube',
  'Corrugated Sheet 2400mm': 'corrugated metal sheet',
  'Ridge Cap Steel': 'roof ridge cap',
  'Gutter 3m': 'rain gutter',
  'Downpipe 2m': 'downspout',
  'Roof Felt 10m Roll': 'roofing felt roll',
  'Laminate Planks 2.2m²': 'laminate flooring planks',
  'Vinyl Roll 3m': 'vinyl flooring roll',
  'Engineered Oak 1.5m²': 'engineered wood flooring',
  'Tile Backer Board': 'cement backer board',
  'Floor Underlay 10m²': 'floor underlayment',
  'Floor Scraper 200mm': 'floor scraper',
  'Skirting 2400mm': 'baseboard',
  'Hi-Vis Vest': 'safety vest',
  'Ear Defenders': 'ear muffs',
  'Dust Mask FFP2 5pc': 'respirator mask',
  'Fall Arrest Harness': 'safety harness',
  'Exterior Door 900mm': 'front door',
  'Door Frame Kit': 'door frame',
  'Window 900×600': 'house window',
  'Threshold Strip 900mm': 'door threshold',
  'Weather Strip Roll': 'weatherstripping',
  'Sink Mixer Chrome': 'kitchen faucet',
  'Vanity Basin 600mm': 'bathroom sink',
  'Pull-out Kitchen Tap': 'kitchen faucet',
  'Towel Rail Chrome': 'towel bar',
  'Shower Screen 900mm': 'shower door',
  'Bath Panel 1700mm': 'bathtub',
  'Close-Coupled WC': 'flush toilet',
  'Cabinet Pulls 10pc': 'drawer handles',
  'De-Icer Salt 10kg': 'rock salt bag',
  'Gazebo Side Panel': 'pop up canopy',
  'Action Figure 30cm': 'action figure',
  'Advent Calendar': 'advent calendar',
  'Baby Onesies 5-pack': 'baby onesie',
  'Baby Sleep Sack': 'baby sleeping bag',
  'Basketball Size 7': 'basketball',
  'Beach Towel': 'beach towel',
  'Beads Assortment 2000pc': 'beads',
  'Bed Sheet Set Queen': 'bed sheet set',
  'Bestseller Novel': 'hardcover book',
  'Bike Helmet Adult': 'bicycle helmet',
  'Birthday Balloons 20pc': 'birthday balloons',
  'Birthday Candles 24pc': 'birthday candles',
  'Blackout Curtains 2pc': 'curtains',
  'Board Game Classic': 'board game',
  'Boys Hoodie': 'hoodie',
  'Boys Jeans': 'jeans',
  'Boys Pajama Set': 'pajamas',
  'Boys Shorts 2-pack': 'shorts',
  'Boys Sneakers': 'sneakers',
  'Boys Tee 3-pack': 't-shirt',
  'Brush Set 10pc': 'paint brushes',
  'Building Bricks 500pc': 'lego bricks',
  'Calendar 2027': 'wall calendar',
  'Canvas 40×50 2-pack': 'canvas',
  'Car Air Freshener': 'car air freshener',
  'Car Charger 2-port': 'car charger',
  'Car Wash Shampoo 2L': 'car wash soap',
  'Card Game Deck': 'playing cards',
  'Cat Tree Tower': 'cat tree',
  'Charcoal 5kg': 'charcoal bag',
  'Christmas Wreath 40cm': 'christmas wreath',
  'Coffee Maker 12-cup': 'coffee maker',
  'Cookbook Hardcover': 'cookbook',
  'Coolant 50/50 4L': 'coolant',
  'Cutlery Set 24pc': 'cutlery set',
  'Desk Lamp LED': 'desk lamp',
  'Dinner Set 16pc': 'dinnerware set',
  'Dog Chew Toy': 'dog toy',
  'Door Wreath Hanger': 'wreath hanger',
  'Dumbbell Set 20kg': 'dumbbells',
  'Duvet Cover Queen': 'duvet cover',
  'Easter Basket': 'easter basket',
  'First Aid Kit 60pc': 'first aid kit',
  'Floor Mats 4pc': 'car floor mats',
  'Food Containers 10pc': 'food storage containers',
  'Frying Pan 28cm': 'frying pan',
  'Gel Pens 12-pack': 'gel pens',
  'Gift Wrap Roll 30m': 'gift wrap',
  'Girls Dress': 'girls dress',
  'Girls Hoodie': 'girls hoodie',
  'Girls Leggings 2-pack': 'leggings',
  'Girls Pajama Set': 'girls pajamas',
  'Girls Sneakers': 'girls shoes',
  'Girls Tee 3-pack': 'girls t-shirt',
  'Glue Gun + Sticks': 'glue gun',
  'Greeting Cards 8pc': 'greeting card',
  'Halloween Pumpkin Decor': 'halloween pumpkin',
  'HDMI Cable 2m': 'hdmi cable',
  'Hiking Boots': 'hiking boots',
  'Ice Scraper': 'ice scraper',
  'Journal Notebook': 'notebook',
  'Jump Starter 600A': 'jump starter',
  'Kettle 1.7L': 'electric kettle',
  'Kids Light-up Sneakers': 'kids sneakers',
  'Kids Storybook': "children's book",
  "Ladies' Blouse": 'blouse',
  "Ladies' Cardigan": 'cardigan',
  "Ladies' Jeans": 'womens jeans',
  "Ladies' Leggings": 'leggings',
  "Ladies' Scarf": 'scarf',
  "Ladies' Tee 3-pack": 't-shirt',
  'Laptop 15"': 'laptop',
  'Laundry Basket Foldable': 'laundry basket',
  'Lawn Seed 2kg': 'grass seed',
  'Magazine Special': 'magazine',
  'Mattress Topper Queen': 'mattress topper',
  "Men's Belt Leather": 'leather belt',
  "Men's Chinos": 'chinos',
  "Men's Hoodie": 'hoodie',
  "Men's Jeans": 'jeans',
  "Men's Polo": 'polo shirt',
  "Men's Tee 3-pack": 't-shirt',
  'Mixing Bowls 5pc': 'mixing bowls',
  'Motor Oil 5W-30 5L': 'motor oil',
  'Notebook 3-pack': 'notebook',
  'Number Balloon 90cm': 'number balloon',
  'Office Chair Mesh': 'office chair',
  'Origami Paper 200pc': 'origami paper',
  'Paper Ream 500 Sheets': 'paper ream',
  'Party Bags 10pc': 'party bags',
  'Party Banner': 'party banner',
  'Patio Chair Foldable': 'folding chair',
  'Pet Bowl Set': 'pet bowl',
  'Phone Car Mount': 'phone car mount',
  'Picture Hooks 50-pack': 'picture hooks',
  'Plush Bear 40cm': 'teddy bear',
  'Poster Print 60×90': 'poster',
  'Power Bank 20000mAh': 'power bank',
  'Puzzle 1000pc': 'jigsaw puzzle',
  'Race Track Set': 'toy race track',
  'RC Car 1:16': 'rc car',
  'Resistance Bands 5-pack': 'resistance bands',
  'Roof Cargo Box': 'roof box',
  'Running Shoes': 'running shoes',
  'Sandals Pair': 'sandals',
  'Scrapbook Kit': 'scrapbook',
  'Seat Covers 2pc': 'car seat covers',
  'Sleeping Bag': 'sleeping bag',
  'Slippers Fleece': 'slippers',
  'Smart TV 50"': 'television',
  'Smart Watch': 'smartwatch',
  'Sneakers Unisex 42': 'sneakers',
  'Stapler Heavy Duty': 'stapler',
  'Sticky Notes 12-pack': 'sticky notes',
  'Storage Bins 6-pack': 'storage bins',
  'String Lights 10m': 'string lights',
  'Sunshade UV 50': 'windshield sun shade',
  'Tablet 10"': 'tablet computer',
  'Tent 4-Person': 'tent',
  'Throw Blanket Soft': 'throw blanket',
  'Tire Inflator 12V': 'tire inflator',
  'Tow Rope 4t': 'tow rope',
  'Travel Guide': 'travel guide book',
  'Trunk Organizer': 'trunk organizer',
  'Wall Anchors 100-pack': 'wall anchors',
  'Wiper Blades Pair': 'wiper blades',
  'Wireless Earbuds': 'wireless earbuds',
  'Yarn 4-pack': 'yarn',
  'Yoga Mat 6mm': 'yoga mat',
  // second-pass terms: the plain product words found only scene photos
  'Stud 45×90×2400mm': 'dimensional lumber',
  'Architrave Set 2400mm': 'door casing',
  'Dado Rail 2400mm': 'chair rail',
  'Wood Stain 946ml': 'wood stain varnish',
  'Hose Bib 20mm': 'outdoor tap',
  'Rain Shower Head': 'shower head',
  'Plywood Sheet 18mm': 'plywood',
  'MDF Board 12mm': 'fibreboard',
  'OSB Sheet 11mm': 'oriented strand board',
  'Potting Mix 40L': 'potting soil',
  'Steel Fire Pit': 'fire pit',
  'Outdoor Pizza Oven': 'wood fired oven',
  'Smart Bulb 2-pack': 'led light bulb',
  'Fairy Lights 20m': 'fairy lights',
  'Gazebo 3×3m': 'gazebo',
  'Gazebo Side Panel': 'gazebo',
  'Shower Screen 900mm': 'shower enclosure',
  'Vinyl Roll 3m': 'vinyl flooring',
  'Weather Strip Roll': 'door seal',
  'Ridge Cap Steel': 'roof ridge',
  'Crack Filler 1L': 'silicone sealant',
  'Bottle Trap 40mm': 'drain trap',
  'Tap Washer Assortment': 'faucet washer',
  'Gel Knee Pads': 'kneepads',
  'Baby Sleep Sack': 'sleep sack',
  'Bed Sheet Set Queen': 'bed sheets',
  'LED Shop Light 1.2m': 'fluorescent light fixture',
  'De-Icer Salt 10kg': 'rock salt',
  'Pendant Lamp Kit': 'pendant light',
  'Lighter': 'disposable lighter',
  'Phone Charging Cable': 'usb charging cable',
  'Bird Seed 3kg': 'bird seed bag',
  'Diapers Size 4 44pc': 'diapers pack',
};

/** default search term: the product words of the name (sizes, counts and
 *  pack wording dropped — they only narrow the search) */
function searchTerm(name) {
  if (TERMS[name]) return TERMS[name];
  return name
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*(mm|cm|m|ml|cl|l|g|kg|oz|lb|ga|w|v|a|btu|mah|pc|pack|rolls?|sheets?|tabs|bulbs?|zones?|heads?|burner)\b/g, ' ')
    .replace(/\d+([:.×/]\d+)?/g, ' ')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\b(set|kit|pair|assortment|foldable|classic|special|heavy duty|unisex|adult|size|person)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ══════════════════════════════════════════════════════════════════════════
   Candidate filtering + ranking
   ══════════════════════════════════════════════════════════════════════════ */
const STOP = new Set(['set', 'kit', 'pack', 'pair', 'with', 'and', 'for', 'the']);
/** Container words a search adds to point at the product ("paint can") —
 *  nice to see in a title, never required. */
const OPTIONAL = new Set(['can', 'bottle', 'bag', 'box', 'bucket', 'jar']);

/** Words that mark a photo as a scene, a person or a picture OF something
 *  rather than a product shot. The item's own words are removed first, so
 *  "LED shop light" or "dog chew toy" still match. */
const SCENE = new RegExp(
  '\\b(boys?|girls?|wom[ae]n|men|kid|kids|child|children|bab(?:y|ies)|lady|ladies|guy|person|people|' +
    'cyclist|rider|wearing|holding|portrait|selfie|cosplay|costume|wedding|parade|festival|protest|riot|' +
    'war|battle|museum|exhibit|exhibition|collection|antique|vintage|rusty|abandoned|broken|ruins?|' +
    'cemetery|grave|church|cathedral|monastery|castle|palace|villa|station|street|' +
    'beach|mountain|lake|river|field|meadow|forest|garden|gardens|park|zoo|circus|theatre|theater|' +
    'concert|singer|player|team|match|sunset|sunrise|night|snow|rain|storm|cloud|sky|landscape|panorama|' +
    'aerial|drone|room|bedroom|living|apartment|restaurant|hotel|truck|motorcycle|bicycle|boat|ship|train|' +
    'plane|aircraft|flower|rose|tattoo|graffiti|meme|logo|icon|drawing|illustration|sketch|diagram|chart|' +
    'screenshot|statue|sculpture|carving|halloween|easter|sign|banner|advert|advertisement|' +
    'engraving|lithograph|woodcut|etching|poster|bookplate|catalogue|catalog|' +
    // places — "Stove in the kitchen, Nepal" is a travel photo, not a stove
    'kitchen|bazaar|village|town|city|province|valley|island|coast|desert|geograph|nepal|india|china|africa|europe|' +
    'railway|railroads?)\\b',
  'i'
);
/** …and museum pieces: old objects photographed for an archive. Their titles
 *  name a civilisation, a collection or a date, never a product. */
const MUSEUM =
  /\bMET sf\d+\b|Metropolitan Museum|ancient|antiquit|\d{1,2}(th|st|nd|rd) century|\bBCE?\b|Egyptian|Dynasty|excavat|archaeolog|medieval|terracotta|temple|tempio|fondo/i;

/** Commons licence names that allow commercial use and modifications. */
const OK_LICENCE = /^(cc0|cc[- ]by|public domain|pdm|no restrictions)/i;

/** A pick good enough to stop looking at further sources. */
const STRONG = 2.1;
/** The least total score that still beats a generated packshot. */
const ACCEPT = 1.45;
/** …and a photo must look like a product shot: either its title simply IS
 *  the product ("Claw hammer" — not "Bee-eater on a wooden post"), or the
 *  product sits on a plain studio backdrop. A scene photo that merely
 *  mentions the product is no pick at all. */
const TITLE_IS_PRODUCT = 1.5;
const STUDIO_BACKDROP = 0.7;
/** Below this a photo is worth a second look (`--retry-weak`). */
const WEAK = 1.75;
/** How many candidates of one source get downloaded and scored. */
const CANDIDATES = 8;

/** The search term's words that carry meaning ("set", "kit", "pack" don't). */
const wordsOf = (term) => [...new Set(term.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))];

/** A title's words, lower-cased and split ("Cordless-Grill, 2-pack" → three). */
const tokensOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);

/** Does a title contain the word `w` — allowing for a plural or -ing
 *  ("drill" matches "drills" and "drilling", but not "painted" or "drilling
 *  press"'s neighbours)? */
const hasWord = (tokens, w) => tokens.some((t) => t === w || ['s', 'es', 'er', 'ers', 'ing'].some((end) => t === w + end));

/** How much of the search term the title covers (0..1.25): every required
 *  word counts, and a container word ("can" in "paint can") is a bonus. */
function relevance(title, term) {
  const tokens = tokensOf(title);
  const words = wordsOf(term);
  const required = words.filter((w) => !OPTIONAL.has(w));
  const hit = (list) => list.filter((w) => hasWord(tokens, w)).length;
  if (!words.length) return 0;
  return (required.length ? hit(required) / required.length : 1) + 0.25 * hit(words.filter((w) => OPTIONAL.has(w)));
}

/** Does the title name the product itself? The term's words must (almost)
 *  all be there — a two-word product needs both ("BEACH towel" is not "a
 *  history of towels"), a longer one may miss a single word ("hammer drill"
 *  for "rotary hammer drill") — and the LAST word, what the product is,
 *  always ("interior paint CAN" is a can, so a museum piece that is "painted
 *  interior" is no match). Container words are never required. */
function titleMatch(title, term) {
  const tokens = tokensOf(title);
  const words = wordsOf(term);
  const required = words.filter((w) => !OPTIONAL.has(w));
  const need = Math.max(1, required.length - (required.length >= 3 ? 1 : 0));
  const head = words[words.length - 1];
  const ok =
    required.filter((w) => hasWord(tokens, w)).length >= need &&
    (!head || OPTIONAL.has(head) || hasWord(tokens, head));
  return { rel: Math.min(1, relevance(title, term)), ok };
}

/** Words that make a title a sentence rather than a name. */
const SENTENCE = new Set(['in', 'on', 'at', 'with', 'of', 'a', 'an', 'the', 'for', 'and', 'to', 'from', 'is', 'are', 'my', 'our', 'your', 'his', 'her', 'its', 'into', 'while', 'during']);

/** How well a title names the product (0..2). A title that IS the product
 *  name — allowing a brand or a model ("Wireless Arlo video doorbell") —
 *  beats a sentence that merely mentions it ("I love the gas grill built
 *  into my stove"): the first is a product shot, the second a photo of
 *  something else. */
function titleScore(title, term) {
  const rel = titleMatch(title, term).rel;
  if (rel < 0.5) return 0;
  // words as spaced, not as split: "Char-Broil-Classic-Gas-Grill" is a
  // product-shot filename, not a sentence
  const words = title.trim().split(/\s+/);
  const extra = Math.max(0, words.length - term.split(/\s+/).length);
  const sentence = /,/.test(title) || words.filter((w) => SENTENCE.has(w.toLowerCase())).length >= 2;
  return Math.min(1.25, relevance(title, term)) + (sentence ? 0.5 * Math.max(0, 1 - extra / 6) : 0.75 - 0.12 * extra);
}

function isScene(title, term) {
  let t = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const w of term.toLowerCase().split(/\s+/)) t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ');
  return SCENE.test(t) || MUSEUM.test(title);
}

/* ══════════════════════════════════════════════════════════════════════════
   Sources
   ══════════════════════════════════════════════════════════════════════════ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCall = new Map();
const baseGap = new Map();
const gaps = new Map();
/** At least `gap` ms between calls of one kind. A "slow down" answer (429)
 *  doubles that gap for the rest of the run — the servers set the pace. */
async function pace(kind, gap) {
  if (!baseGap.has(kind)) baseGap.set(kind, gap);
  if (!gaps.has(kind)) gaps.set(kind, gap);
  const wait = (lastCall.get(kind) ?? 0) + gaps.get(kind) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(kind, Date.now());
}
const slowDown = (kind) => {
  pace(kind, 500); // make sure the kind is known before doubling its gap
  gaps.set(kind, Math.min(8000, gaps.get(kind) * 2));
};

async function get(url, as = 'json', kind = 'other') {
  let retryAfter = 0;
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return as === 'json' ? await res.json() : Buffer.from(await res.arrayBuffer());
      // 429 = asked to slow down (honoured below); anything else that isn't
      // a server hiccup (5xx) is gone for good — don't spend a minute on it
      if (res.status !== 429 && res.status < 500) return null;
      if (res.status === 429) {
        slowDown(kind);
        retryAfter = Number(res.headers.get('retry-after')) * 1000;
      }
      if (process.env.FETCH_DEBUG) console.log(`   · ${res.status} (attempt ${a + 1}) ${url.slice(0, 90)}`);
    } catch (err) {
      if (process.env.FETCH_DEBUG) console.log(`   · ${err.name} ${url.slice(0, 90)}`);
    }
    // wait what the server asked for when it said so
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30000) : 2000 * (a + 1));
  }
  return null;
}

/** Openverse serves 200 anonymous searches and 1000 thumbnails a day per
 *  IP — the counts are kept across runs so a re-run never burns the budget. */
const today = new Date().toISOString().slice(0, 10);
const budget = (() => {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (s.date === today) return s;
  } catch { /* first run today */ }
  return { date: today, searches: 0, thumbs: 0 };
})();
const saveBudget = () => fs.writeFileSync(STATE, JSON.stringify(budget));
const OV_SEARCH_CAP = 185;
const OV_THUMB_CAP = 960;
const OV_THUMBS_PER_ITEM = 4;

async function openverse(term) {
  if (budget.searches >= OV_SEARCH_CAP) return [];
  await pace('ov-search', 3400); // ≤ 17 a minute (limit: 20/min)
  budget.searches++;
  saveBudget();
  const j = await get(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&page_size=20&license_type=commercial,modification`,
    'json',
    'ov-search'
  );
  return (j?.results ?? []).map((r) => ({
    id: `openverse:${r.id}`,
    title: r.title || '',
    page: r.foreign_landing_url,
    thumb: r.thumbnail,
    license: `${r.license} ${r.license_version ?? ''}`.trim(),
    author: r.creator || '',
    via: 'openverse',
    w: r.width || 0,
    h: r.height || 0,
  }));
}

async function commons(term) {
  const out = [];
  for (const q of [term, `${term} white background`]) {
    await pace('commons', 500);
    const j = await get(
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15' +
        `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}` +
        '&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=640',
    'json',
    'commons'
  );
    for (const p of Object.values(j?.query?.pages ?? {})) {
      const i = p.imageinfo?.[0];
      if (!i || !/image\/(jpeg|png)/.test(i.mime ?? '')) continue;
      const m = i.extmetadata ?? {};
      const lic = (m.LicenseShortName?.value ?? '').trim();
      if (!OK_LICENCE.test(lic) || /NC|ND/i.test(lic)) continue;
      out.push({
        id: `commons:${p.title}`,
        title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
        page: i.descriptionurl,
        thumb: i.thumburl,
        license: lic,
        author: (m.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim(),
        via: 'wikimedia commons',
        w: i.width,
        h: i.height,
      });
    }
  }
  return [...new Map(out.map((c) => [c.id, c])).values()];
}

/* ══════════════════════════════════════════════════════════════════════════
   Packshot scoring (packshot.py)
   ══════════════════════════════════════════════════════════════════════════ */
let pyOk = false;
try {
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
  pyOk = true;
} catch { /* scored on title alone, saved uncropped */ }
const py = (...a) =>
  JSON.parse(execFileSync('python3', [PACKSHOT, ...a], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim() || '{}');

/** 1 when the product fills a sane share of the frame, falling to 0 at the
 *  edges (a speck, or an edge-to-edge crop). */
const fillScore = (f) => (f < 0.25 ? Math.max(0, (f - 0.02) / 0.23) : f <= 0.8 ? 1 : Math.max(0, (1 - f) / 0.2));

function visualScore(a) {
  return 0.35 * a.uniform + (a.light > 0.75 ? 0.15 : a.light < 0.4 ? -0.2 : 0) + 0.35 * fillScore(a.fill);
}

/* ══════════════════════════════════════════════════════════════════════════
   Main
   ══════════════════════════════════════════════════════════════════════════ */
fs.mkdirSync(OUT, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
// a grocery stand-in that the food database has served a photo for since our
// pick is no longer ours: drop the entry and its now-unused file, so the
// credits only ever list photos the demo actually shows. (Only a REPLACED
// photo counts — a name missing from the map just means a run was
// interrupted before writing it, and those picks are kept.)
{
  const map = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
  const used = Object.values(map);
  for (const [name, m] of Object.entries(manifest)) {
    if (m.grocery && map[name] && map[name] !== m.file && !used.includes(m.file)) {
      fs.rmSync(path.join(OUT, path.basename(m.file)), { force: true });
      delete manifest[name];
    }
  }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-photos-cc-'));

// Home Depot goes to Openverse first (its day budget only covers one wing);
// the Walmart wing starts on Commons and borrows Openverse' leftovers.
const groups = [
  { names: HOME_DEPOT, order: ['openverse', 'commons'] },
  { names: WALMART_GENERAL, order: ['commons', 'openverse'] },
];
let wanted = groups.flatMap((g) => g.names.map((name) => ({ name, order: g.order })));
// --leftovers: the grocery lists' items that still map to a generated
// packshot — the food database was down for them (it rate-limits hard), so
// look for them here too, with the same search term that script uses
if (flag('--leftovers')) {
  const current = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
  for (const list of [CORNER_STORE, WALMART, ORIGINAL]) {
    for (const [name, term] of list) {
      if (current[name]?.endsWith('.jpg')) continue;
      wanted.push({ name, order: ['commons', 'openverse'], term, grocery: true });
    }
  }
}
const only = val('--only');
if (only) {
  const keep = new Set(only.split(',').map((s) => s.trim()));
  wanted = wanted.filter((w) => keep.has(w.name));
}
if (!flag('--force')) {
  wanted = wanted.filter((w) => {
    const m = manifest[w.name];
    if (!m) return true;
    if (flag('--retry') && m.fallback) return true;
    if (!flag('--retry-weak') || m.fallback) return false;
    // a weak pick: scored under the current bar — a title that isn't the
    // product on its own, backed by a so-so backdrop (see ACCEPT)
    const term = w.term ?? TERMS[w.name] ?? searchTerm(w.name);
    const title = titleScore(m.title, term);
    // picks from before the visual score was recorded are judged by what is left of their score
    const visual = m.visual ?? (m.score ?? 9) - title;
    return (m.score ?? 9) < ACCEPT || (title < TITLE_IS_PRODUCT && visual < STUDIO_BACKDROP);
  });
}

const saveManifest = () => {
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
  );
};

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
const writeCredits = () => {
  const currentMap = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
  const rows = Object.entries(manifest)
    // only photos the demo actually shows (a grocery stand-in that the food
    // database has since replaced is left out)
    .filter(([name, m]) => !m.fallback && (!m.grocery || currentMap[name] === m.file))
    .map(([name, m]) => `| ${cell(name)} | ${cell(m.title)} | ${cell(m.author) || '—'} | ${cell(m.license)} | [${cell(m.via)}](${m.page}) |`);
  fs.writeFileSync(
    CREDITS,
    [
      '# Demo product photos — openly-licensed sources', '',
      'Hardware, garden, electronics, apparel and toy photos for the demo stores. Each is published under a',
      'licence that allows commercial use and modifications (CC0, CC BY, CC BY-SA) or is in the public domain,',
      'found through [Openverse](https://openverse.org) and [Wikimedia Commons](https://commons.wikimedia.org).',
      'Photos are cropped to the product and resized.', '',
      'Grocery photos come from a different source — see [ATTRIBUTION.md](ATTRIBUTION.md).', '',
      'Regenerate: `node backend/scripts/fetch-demo-photos-cc.mjs` (picks live in `backend/scripts/demo-photos-cc.json`).', '',
      'The photo files live in `backend/demo-products/` and are stored in the database',
      '(its `media` table) by `backend/scripts/seed-demo.mjs` — nothing ships with the frontend.', '',
      '| Demo product | Photo | Author | Licence | Source page |', '|---|---|---|---|---|',
      ...rows, '',
    ].join('\n')
  );
};

const writePhotoMap = () => {
  // re-read here: the food script can finish while this one runs
  const map = fs.existsSync(PHOTO_MAP) ? JSON.parse(fs.readFileSync(PHOTO_MAP, 'utf8')) : {};
  const ours = (name) => `/media/${slug(name)}.jpg`;
  for (const [name, m] of Object.entries(manifest)) {
    if (m.file.endsWith('.jpg')) {
      // a real photo always beats a generated packshot, and the food
      // database's photo beats our stand-in for a grocery item
      if (!m.grocery || !map[name]?.endsWith('.jpg')) map[name] = m.file;
    } else {
      // No usable photo. For one of OUR lists that also retires an earlier
      // pick that a later, stricter pass rejected — unless another name
      // still uses that file (a grocery stand-in defers to the food
      // database's photo instead, whenever that arrives)
      const stale = !m.grocery && map[name] === ours(name);
      if (stale && !Object.entries(map).some(([other, url]) => other !== name && url === ours(name))) {
        fs.rmSync(path.join(OUT, path.basename(ours(name))), { force: true });
      }
      if (stale || !map[name]?.endsWith('.jpg')) map[name] = m.file;
    }
  }
  fs.writeFileSync(
    PHOTO_MAP,
    JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
  );
};

/** Download a source's candidate previews, a few at a time. Returns
 *  `[{ candidate, file }]`; a preview is skipped when its download failed or
 *  (Openverse) the day budget is spent — that budget only covers the Home
 *  Depot wing, so no item may spend more than OV_THUMBS_PER_ITEM of it. */
async function fetchThumbs(found, startAt) {
  let ovThumbs = 0;
  const out = [];
  // sequential and paced: both hosts rate-limit bursts, and a 429 costs far
  // more time than the waiting does
  for (const [i, c] of found.entries()) {
    if (i >= CANDIDATES) break;
    const kind = c.via === 'openverse' ? 'ov-thumb' : 'commons-thumb';
    if (c.via === 'openverse') {
      // the day budget only covers the Home Depot wing — no item may spend
      // more than a few of it
      if (budget.thumbs >= OV_THUMB_CAP || ovThumbs >= OV_THUMBS_PER_ITEM) continue;
      await pace(kind, 150);
      budget.thumbs++;
      saveBudget();
      ovThumbs++;
    } else {
      await pace(kind, 450);
    }
    const buf = await get(c.thumb, 'buf', kind);
    if (!buf) continue;
    const file = path.join(TMP, `t${startAt++}`);
    fs.writeFileSync(file, buf);
    out.push({ candidate: c, file });
  }
  return out;
}

let ok = 0;
let fellBack = 0;
try {
  for (const [n, { name, order, term: wantedTerm, grocery }] of wanted.entries()) {
    const term = wantedTerm ?? TERMS[name] ?? searchTerm(name);
    const label = `[${n + 1}/${wanted.length}] ${name} → "${term}"`;
    let best = null;
    let thumbN = n * 64;
    // each source in turn, until one yields a strong pick
    for (const source of order) {
      const found = (await (source === 'openverse' ? openverse : commons)(term)).filter(
        (c) => c.thumb && !isScene(c.title, term) && titleMatch(c.title, term).ok
      );
      // best titles first, so the preview budget is spent on the likely picks
      found.sort((a, b) => titleScore(b.title, term) - titleScore(a.title, term));
      const thumbs = await fetchThumbs(found, thumbN);
      thumbN += CANDIDATES;
      const scored = thumbs.map(({ candidate, file }) => {
        const title = titleScore(candidate.title, term);
        return { candidate, file, title, visual: 0.6, score: title + 0.6 }; // 0.6 = unknown, until analysed
      });
      if (pyOk && scored.length) {
        // one process scores the whole batch; an unreadable preview keeps its
        // title score alone
        try {
          const analysed = py('analyze', ...scored.map((s) => s.file));
          scored.forEach((s, k) => {
            if (analysed[k].fill < 0.02) {
              s.score = -1; // an empty frame is no pick at all
              return;
            }
            s.visual = visualScore(analysed[k]);
            s.score = s.title + s.visual;
          });
        } catch { /* keep title scores */ }
      }
      const usable = scored.filter(
        (s) => s.score >= ACCEPT && (s.title >= TITLE_IS_PRODUCT || s.visual >= STUDIO_BACKDROP)
      );
      best = usable.reduce((b, s) => (!b || s.score > b.score ? s : b), best);
      if (best && best.score >= STRONG) break;
    }
    if (!best) {
      manifest[name] = { file: writePackshotSvg(path.join(OUT, 'gen'), name), fallback: true };
      fellBack++;
      console.log(`✗ ${label} — no usable photo, generated packshot`);
    } else {
      const { candidate: c } = best;
      const out = path.join(OUT, `${slug(name)}.jpg`);
      if (pyOk) {
        // crop to the product when the backdrop is flat, shrink to tile size
        py('finish', best.file, out);
      } else {
        fs.copyFileSync(best.file, out);
      }
      manifest[name] = {
        file: `/media/${slug(name)}.jpg`,
        score: Number(best.score.toFixed(2)),
        visual: Number((best.score - titleScore(c.title, term)).toFixed(2)),
        title: c.title,
        // grocery: this pick stands in for the food database — a photo from
        // there is the better one, whenever it arrives
        ...(grocery ? { grocery: true } : {}),
        author: c.author, license: c.license, page: c.page, via: c.via,
      };
      ok++;
      console.log(`✓ ${label} — "${c.title.slice(0, 50)}" (${c.license}, ${c.via}, score ${best.score.toFixed(2)})`);
    }
    // saved after EVERY item: an interrupted run (or a re-run for one item)
    // must never lose the picks or the credits already made
    saveManifest();
    writePhotoMap();
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

saveManifest();
writePhotoMap();
writeCredits();
console.log(`\n${ok} picked + ${fellBack} fallback = ${ok + fellBack} items · openverse today: ${budget.searches} searches, ${budget.thumbs} thumbnails`);
console.log(`Credits: ${path.relative(process.cwd(), CREDITS)} · mapping merged into ${path.relative(process.cwd(), PHOTO_MAP)}`);
