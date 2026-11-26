/**
 * The Corner Store example's shelves, by department — one row per product:
 *
 *     product ~ brands that really make it ~ kind of product [~ min|max price]
 *
 * A convenience store, so its rows are grocery and drink rows; it shares the
 * grocery vocabulary. demo-catalog-kit.mjs explains the row.
 */
import "./demo-catalog-kinds-grocery.mjs";
import { D } from "./demo-catalog-kit.mjs";

export default {
  "Soft Drinks": D(`
-~Coca-Cola|Pepsi|Dr Pepper|RC Cola|Big Red|Faygo|Shasta|Virgil's~cola
-~Sprite|7UP|Starry|Sierra Mist|Faygo|Shasta|Seagram's~lemonLime
-~Mountain Dew|Sun Drop|Mello Yello|Surge|Kickstart|Faygo~citrusSoda
-~A&W|Mug|Barq's|Dad's|IBC|Stewart's|Sprecher|Frostie~rootBeer
-~Canada Dry|Schweppes|Seagram's|Vernors|Ale-8-One|Buffalo Rock|Fever-Tree~gingerAle
-~Fanta|Sunkist|Crush|Minute Maid|Nehi|Faygo|Shasta|Slice~fruitSoda
-~Gatorade|Powerade|BODYARMOR|Propel|Prime|Vitaminwater|Sqwincher|All Sport|Liquid I.V.~sportsDrink
-~Red Bull|Monster|Rockstar|Bang|Celsius|Reign|5-hour Energy|Ghost|Alani Nu|Zoa|Full Throttle|NOS|C4 Energy~energyDrink
-~Coca-Cola|Pepsi|Aquafina|Dasani|Pure Life|Fiji|Smartwater|Evian|Deer Park|Poland Spring|Core Hydration|Essentia|Liquid Death~water
-~LaCroix|Bubly|Spindrift|Polar|Aha|Perrier|San Pellegrino|Topo Chico|Waterloo|Zevia~sparklingWater
-~Tropicana|Minute Maid|Simply|Florida's Natural|Dole|Welch's|Ocean Spray|Mott's|Snapple|Langers|Martinelli's~juice
`),
  "Milk & Dairy": D(`
Milk~Dean's|PET|Borden|Clover|Hood|Darigold|Prairie Farms|Hiland|Mayfield|Turner Dairy|Shenandoah's Pride|Garelick Farms|Crowley|Meadow Gold|Organic Valley|Horizon Organic~milk
Yogurt~Dannon|Yoplait|Chobani|Stonyfield|Light + Fit|Fage|Oikos|Noosa|LALA|Tillamook|Great Value~yogurt
Cheese~Kraft|Sargento|Tillamook|Crystal Farms|Land O Lakes|Borden|Great Value|Cabot~shreddedCheese
Eggs~Land O Lakes|Eggland's Best|Clover|Sauder's|Great Value|Pete & Gerry's|Vital Farms~eggs
Butter~Land O Lakes|Kerrygold|Challenge|Plugrá|Great Value|Cabot|Tillamook~butter
Half & Half~Land O Lakes|Darigold|Hood|PET|Clover|Horizon Organic|Great Value~cream
`),
  "Beer & Cider": D(`
Beer~Budweiser|Coors Banquet|Miller High Life|Corona Extra|Modelo Especial|Yuengling|Pabst Blue Ribbon|Hamm's|Old Milwaukee|Rolling Rock|Stella Artois|Heineken~lagerBeer
Beer~Bud Light|Michelob Ultra|Natural Light|Busch Light|Miller Lite|Coors Light|Keystone Light|Corona Light~lightBeer
Ale~Sierra Nevada|Lagunitas|New Belgium|Dogfish Head|Goose Island|Brooklyn|Sam Adams|Victory|Fat Tire|Blue Moon~ale
Hard Seltzer~White Claw|Truly|Bon & Viv|Michelob Ultra|Corona|High Noon|Vizzy|Topo Chico~seltzer
-~Angry Orchard|Strongbow|Woodchuck|Redd's|Johnny Appleseed|Ciderboys|Austin Eastciders|2 Towns Ciderhouse|Crispin|Magners|Somersby|Rekorderlig|Kopparberg|Bold Rock~cider
-~Twisted Tea|Smirnoff Ice|Bartles & Jaymes|Seagram's Escapes|Mike's Hard|Henry's Hard Sparkling~hardLemonade
`),
  "Salty Snacks": D(`
Potato Chips~Lay's|Ruffles|Kettle Brand|Cape Cod|Utz|Herr's|Wise|Pringles~chips
Tortilla Chips~Doritos|Tostitos|On The Border|Mission|Late July|Santitas~tortilla
Pretzels~Rold Gold|Snyder's of Hanover|Utz|Herr's|Flipz|Dot's Homestyle Pretzels~pretzels
Popcorn~Smartfood|SkinnyPop|Angie's|Boomchickapop|Orville Redenbacher's|Jolly Time|LesserEvil~popcornRTE
Cheese Puffs~Cheetos|Utz|Herr's|Pirate's Booty|Andy Capp's~cheesePuffs
Pork Rinds~Utz|Baken-ETS|Pork King|Mac's|Lowrey's~porkRinds
Nuts~Planters|Blue Diamond|Diamond|Emerald|Wonderful|Sahale Snacks|Fisher~nuts
Jerky~Jack Link's|Oberto|Old Wisconsin|Tillamook Country Smoker|Krave|Country Archer~jerky
Meat Sticks~Slim Jim|Jack Link's|Old Wisconsin|Tillamook Country Smoker|Oberto|Klement's~meatSticks
Crackers~Cheez-It|Ritz|Goldfish|Nabisco|Keebler|Lance~sandwichCrackers
`),
  "Candy & Chocolate": D(`
Candy Bar~Snickers|Twix|3 Musketeers|Butterfinger|Milky Way|Baby Ruth|100 Grand|Heath|Take 5|Almond Joy|Mounds~candyBar
Chocolate Bar~Hershey's|Cadbury|Ghirardelli|Lindt|Toblerone|Dove|Milka~chocolateBar
Peanut Butter Cups~Reese's|Justin's|UNREAL|YumEarth~pbCups
Gummy Candy~Haribo|Trolli|Black Forest|Albanese|Welch's|Smart Sweets~gummy
Hard Candy~Jolly Rancher|Life Savers|Werther's Original|Starlight Mints|LemonHeads~hardCandy
Chewy Candy~Starburst|Skittles|Milk Duds|Hi-Chew|Now and Later|Laffy Taffy|Mentos|Airheads|Nerds|Sour Patch Kids~chewyCandy
`),
  "Coffee & Tea": D(`
Coffee~Folgers|Maxwell House|Dunkin'|Starbucks|Eight O'Clock|Chock full o'Nuts|Café Bustelo|Community Coffee|Green Mountain~groundCoffee
K-Cup Pods~Green Mountain|Dunkin'|Starbucks|Folgers|The Donut Shop|McCafé|Café Bustelo|Swiss Miss~kcup
Instant Coffee~Folgers|Maxwell House|Nescafé|Taster's Choice|Starbucks VIA|Café Bustelo~instantCoffee
Tea~Lipton|Bigelow|Twinings|Celestial Seasonings|Red Rose|Tetley~teaBags
-~Lipton|Snapple|Arizona|Pure Leaf|Gold Peak|Brisk|Red Diamond|Turkey Hill|Milo's~rtdTea
-~Starbucks|Dunkin'|La Colombe|Java Monster|Chameleon|Stok|Super Coffee~rtdCoffee
`),
  "Hot Food": D(`
-~Hillshire Farm|Ball Park|Nathan's Famous|Oscar Mayer|Tyson|Jimmy Dean|Johnsonville|El Monterey|Ruiz|Jose Ole|Tina's|Totino's|Red Baron|Bridgford|State Fair|Campbell's|Stouffer's|Banquet|White Castle|Pillsbury|Sara Lee|Tastykake|Entenmann's|Cloverhill|Mrs. Freshley's|Hormel|Boar's Head|Fratelli Beretta~hotFood
`),
  "Pantry Essentials": D(`
Soup~Campbell's|Progresso|Chunky|Healthy Request|Dinty Moore|Bear Creek~soup
Macaroni & Cheese~Kraft|Velveeta|Annie's|Great Value~macCheese
Rice~Uncle Ben's|Great Value|Mahatma|Minute|Zatarain's~rice
Pasta~Barilla|Ronzoni|Great Value|Mueller's~pasta
-~Ragu|Prego|Great Value|Classico|Hunt's~pastaSauce
Peanut Butter~Jif|Skippy|Peter Pan|Great Value~peanutButter
Canned Tuna~StarKist|Bumble Bee|Chicken of the Sea|Great Value~tuna
-~Bush's|Goya|Great Value|Van Camp's~cannedBeans
Bread~Wonder|Nature's Own|Great Value|Sara Lee|Sunbeam~bread
Tortillas~Mission|Great Value|Guerrero|Tia Rosa~tortillas
Sugar~Domino|Great Value|C&H~sugar
Flour~Pillsbury|Gold Medal|Great Value~flour
`),
  "Household Essentials": D(`
Paper Towels~Bounty|Brawny|Viva|Sparkle|Scott|Great Value~paperTowels
Bath Tissue~Charmin|Angel Soft|Quilted Northern|Cottonelle|Scott|Great Value~bathTissue
Trash Bags~Glad|Hefty|Great Value~trashBags
Dish Soap~Dawn|Palmolive|Great Value~dishSoap
Laundry Detergent~Tide|Gain|All|Arm & Hammer|Great Value~laundryDetergent
-~Clorox|Lysol|Windex|Pine-Sol|Mr. Clean|Febreze~cleaners
-~Ziploc|Glad|Hefty|Great Value~foodStorage
-~Febreze|Glade|Air Wick|Renuzit~airFresh
-~Scrub Daddy|Scotch-Brite|S.O.S|Brillo|Mr. Clean~sponges
`),
  "Ice Cream": D(`
Ice Cream~Blue Bell|Ben & Jerry's|Häagen-Dazs|Breyers|Tillamook|Blue Bunny|Talenti|Turkey Hill|Friendly's|Edy's|Dreyer's~iceCream
-~Good Humor|Magnum|Klondike|Popsicle|Outshine|Yasso|Drumstick|Fudgsicle|Creamsicle|Nestlé~frozenTreats
`),
};
