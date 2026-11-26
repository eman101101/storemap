/**
 * Walmart's shelves, by department — one row per product:
 *
 *     product ~ brands that really make it ~ kind of product [~ min|max price]
 *
 * demo-catalog-kit.mjs explains the row; the kinds a row names are defined
 * in demo-catalog-kinds-grocery.mjs, -general.mjs and -hardware.mjs, which
 * load first so every kind exists before a row refers to it.
 */
import "./demo-catalog-kinds-grocery.mjs";
import "./demo-catalog-kinds-general.mjs";
import "./demo-catalog-kinds-hardware.mjs";
import { D } from "./demo-catalog-kit.mjs";

export default {
  "Dairy & Cheese": D(`
Milk~Great Value|Horizon Organic|Fairlife|Organic Valley|Darigold|PET|Clover|Borden|a2 Milk|Natrel~milk
Heavy Whipping Cream~Great Value|Horizon Organic|Organic Valley|Darigold|PET|Clover|Land O Lakes|Hood|Kalona Super Natural~cream
Half & Half~Great Value|Horizon Organic|Organic Valley|Darigold|PET|Clover|Land O Lakes|Hood|Coffee-mate|Lactaid~cream
Light Cream~Great Value|Organic Valley|Darigold|PET|Clover|Hood|Lactaid~cream
Yogurt~Great Value|Yoplait|Chobani|Dannon|Fage|Stonyfield|Light + Fit|Oikos|Siggi's|Noosa|Activia|Müller|LALA|Tillamook~yogurt
Greek Yogurt~Chobani|Fage|Oikos|Light + Fit|Great Value|Stonyfield|Siggi's|Icelandic Provisions|Cabot|Wallaby|The Greek Gods~greekYogurt
Cottage Cheese~Great Value|Daisy|Kraft|Breakstone's|Good Culture|DairyPure|Hood|Knudsen|Lactaid|Organic Valley|Mueller's|Dean's~softCheese
Sour Cream~Daisy|Great Value|Breakstone's|Kraft|DairyPure|Hood|Tillamook|Organic Valley|Lactaid|Cabot|Borden|Dean's~sourCream
Cream Cheese~Philadelphia|Great Value|Kraft|DairyPure|Breakstone's|Organic Valley|Kite Hill|Miyoko's|Tofutti|Go Veggie~creamCheese
Butter~Great Value|Land O Lakes|Kerrygold|Challenge|Plugrá|Organic Valley|Tillamook|Darigold|Imperial|Blue Bonnet|Cabot|Vermont Creamery|Horizon Organic~butter
Spread~Country Crock|I Can't Believe It's Not Butter!|Great Value|Blue Bonnet|Imperial|Smart Balance|Earth Balance|Parkay|Fleischmann's~spread
Cheese~Kraft|Great Value|Sargento|Tillamook|Crystal Farms|Cabot|BelGioioso|Organic Valley|Boar's Head|Land O Lakes~shreddedCheese
Cheese~Tillamook|Kraft|Cabot|Cracker Barrel|Great Value|BelGioioso|Sargento|Organic Valley|Boar's Head|Crystal Farms|Finlandia~blockCheese
Sliced Cheese~Kraft|Great Value|Sargento|Land O'Frost|Borden|Crystal Farms|Cabot|Finlandia|Boar's Head~slicedCheese
String Cheese~Galbani|Kraft|Frigo|Sargento|Great Value|Organic Valley|Tillamook|BelGioioso|Crystal Farms|Borden|Precious|Lactaid~stringCheese
Eggs~Great Value|Eggland's Best|Land O Lakes|Vital Farms|Pete & Gerry's|Happy Egg|Nellie's Free Range|Clover|Sauder's~eggs
Liquid Egg Whites~Egg Beaters|Great Value|Bob Evans|Eggland's Best|Land O Lakes|Allwhites|Pete & Gerry's~eggProduct
Coffee Creamer~Nestlé Coffee mate|International Delight|Great Value|Dunkin'|Starbucks|Silk|Califia Farms|nutpods|Chobani|Laird Superfood~creamer
`),
  "Deli & Cheese": D(`
Lunchmeat~Oscar Mayer|Great Value|Hillshire Farm|Land O'Frost|Tyson|Hormel|Butterball|Thumann's|Dietz & Watson|Kretschmar|Boar's Head~deliMeat
Deli Cheese~Boar's Head|Sargento|Land O Lakes|Kraft|Great Value|Dietz & Watson|Kretschmar|Finlandia|BelGioioso|Cracker Barrel|Cabot~deliCheese
Bacon~Oscar Mayer|Hormel|Great Value|Smithfield|Tyson|Wright Brand|Farmland|Applegate|Wellshire|Pederson's|Jones~bacon
Hot Dogs~Oscar Mayer|Ball Park|Great Value|Hebrew National|Nathan's Famous|Hillshire Farm|Johnsonville|Bar S|Kayem|Vienna Beef|Sabrett~hotDog
Breakfast Sausage~Johnsonville|Great Value|Hillshire Farm|Bob Evans|Jimmy Dean|Hormel|Aidells|Eckrich|Farmland|Smithfield|Tennessee Pride|Odom's~breakfastSausage
Smoked Sausage~Hillshire Farm|Johnsonville|Great Value|Eckrich|Farmland|Polk's|Klement's|Bob Evans~smokedSausage
Deli Salad~Reser's|Great Value|Mrs. Gerry's|Bob Evans|Hormel|Tyson|Brookwood Farms|Willow Brook~deliSalad
Hummus~Sabra|Great Value|Boar's Head|Cedar's|Tribe|Hope Foods|Ithaca Hummus|Lantana|Roots~hummus
Dip~Heluva Good!|Marzetti|Great Value|Lay's|Tostitos|Hidden Valley|Kraft|Philadelphia|Daisy~dip
`),
  "Adult Beverages": D(`
Beer~Budweiser|Coors Banquet|Miller High Life|Corona Extra|Modelo Especial|Stella Artois|Heineken|Dos Equis|Tecate|Pacifico|Yuengling|Pabst Blue Ribbon|Busch|Hamm's|Old Milwaukee|Rolling Rock|Red Stripe|Tsingtao|Sapporo|Kirin Ichiban|Asahi~lagerBeer
Beer~Bud Light|Michelob Ultra|Natural Light|Busch Light|Miller Lite|Coors Light|Keystone Light|Corona Light|Milwaukee's Light|Yuengling Light~lightBeer
Ale~Sierra Nevada|Stone|Lagunitas|Ballast Point|Bell's|Dogfish Head|Founders|New Belgium|Deschutes|Firestone Walker|Odell|Cigar City|SweetWater|Goose Island|Brooklyn|Sam Adams|Victory|Oskar Blues~ale
Hard Seltzer~White Claw|Truly|Bon & Viv|Michelob Ultra|Corona|Smirnoff|Bud Light|Naturdays|Vizzy|Topo Chico|Cutwater|Press~seltzer
Wine~Barefoot|Woodbridge|Sutter Home|Kendall-Jackson|Meiomi|Josh Cellars|Decoy|Cupcake|Dark Horse|19 Crimes|Apothic|Bogle|Chateau Ste. Michelle|Clos du Bois|Yellow Tail|Ruffino|Louis Jadot|Santa Margherita|Trapiche|Casillero del Diablo|Alamos|Beringer|Lindemans|Rosemount|Penfolds|Wolf Blass|Hardys|Mark West~redWine
Wine~Barefoot|Woodbridge|Sutter Home|Kendall-Jackson|Meiomi|Josh Cellars|Cupcake|Dark Horse|Apothic|Bogle|Chateau Ste. Michelle|Clos du Bois|Yellow Tail|Ruffino|Louis Jadot|Santa Margherita|Trapiche|Casillero del Diablo|Alamos|Beringer|Lindemans|Rosemount|Wolf Blass|Hardys|Mark West~whiteWine
Sparkling Wine~Cook's|Andre|Korbel|Freixenet|Barefoot|Yellow Tail|Martini & Rossi|Veuve Clicquot|Moët & Chandon|Dom Pérignon|Nicolas Feuillatte|La Marca|Mionetto|Ruffino|Chandon|J Roget|Kendall-Jackson|Sterling|Roederer|Taittinger~sparkling
Vodka~Tito's|Smirnoff|Grey Goose|Absolut|Svedka|New Amsterdam|Skyy|Ketel One|Belvedere|Cîroc|Deep Eddy|Hangar 1|Reyka|Chopin|Burnett's|Pinnacle|UV|Three Olives|Purity|Prairie~vodka
Bourbon~Jim Beam|Maker's Mark|Bulleit|Wild Turkey|Evan Williams|Knob Creek|Woodford Reserve|Buffalo Trace|Four Roses|Heaven Hill|Old Forester|Elijah Craig|Angel's Envy|Basil Hayden|1792|Jefferson's|Michter's|Blanton's~bourbon
Scotch~Johnnie Walker|Dewar's|The Glenlivet|Glenfiddich|Macallan|Ballantine's|Cutty Sark|Chivas Regal|Lagavulin|Talisker|Oban|Monkey Shoulder|Glenmorangie|Bowmore|Laphroaig|Ardbeg|Highland Park~scotch
Canadian Whisky~Crown Royal|Canadian Club|Canadian Mist|Seagram's VO|Black Velvet|Pendleton|Gibson's Finest~canadian
Irish Whiskey~Jameson|Tullamore D.E.W.|Bushmills|Redbreast|Teeling|Proper No. Twelve|Powers|Green Spot|Kilbeggan|Slane|West Cork|Connemara~irish
Tennessee Whiskey~Jack Daniel's|George Dickel|Uncle Nearest|Prichard's|Collier and McKeel~tennessee
-~Fireball|Jim Beam|Jack Daniel's|Crown Royal|Sazerac|Evan Williams|Bird Dog|American Honey~flavoredWhiskey
Tequila~Jose Cuervo|Patrón|Don Julio|Herradura|Espolòn|Lunazul|1800|Milagro|Casamigos|El Jimador|Hornitos|Avión|Cazadores|Corralejo|Familia Camarena~tequila
Rum~Bacardi|Captain Morgan|Malibu|Bumbu|Sailor Jerry|Kraken|Appleton Estate|Flor de Caña|Myers's|Diplomatico|Ron Zacapa|Gosling's|Plantation|Cruzan|Don Q|Mount Gay~rum
Gin~Tanqueray|Bombay Sapphire|Beefeater|Gordon's|Hendrick's|Roku|Aviation|Seagram's|New Amsterdam|The Botanist|Monkey 47|Broker's~gin
Cognac~Hennessy|Rémy Martin|Courvoisier|Martell|D'Ussé~cognac
Brandy~Paul Masson|E&J|Christian Brothers|Torres|St-Rémy|Korbel~brandy
Cocktail~Cutwater|High Noon|Bacardi|Jose Cuervo|Jack Daniel's|Chi-Chi's|On The Rocks|Nude~cocktail
-~Twisted Tea|Lipton Hard|Arizona Hard|Boston Beer|Pabst Blue Ribbon~hardTea
-~Mike's Hard|Smirnoff Ice|Bartles & Jaymes|Seagram's Escapes|Henry's Hard|Four Loko|Nütrl|John Daly~hardLemonade
`),
  "Snacks & Candy": D(`
Potato Chips~Lay's|Ruffles|Kettle Brand|Cape Cod|Utz|Herr's|Pringles|Wise|Miss Vickie's|Mikesell's|Ballreich|Zapp's~chips
Tortilla Chips~Doritos|Tostitos|On The Border|Mission|Late July|Santitas|Garden of Eatin'|Paqui|Juanita's|Good Thins~tortilla
Corn Chips~Fritos|Great Value|Bugles|Doritos|Tostitos|Snyder's of Hanover|Herr's|Utz~cornChips
Cheese Puffs~Cheetos|Great Value|Utz|Herr's|Pirate's Booty|Cheez-It|Andy Capp's~cheesePuffs
Pretzels~Rold Gold|Snyder's of Hanover|Great Value|Herr's|Utz|Flipz|Unique|Dot's Homestyle Pretzels~pretzels
Popcorn~Angie's|Smartfood|Great Value|SkinnyPop|Boomchickapop|Orville Redenbacher's|Jolly Time|Act II|Pop Secret|LesserEvil|Pipcorn|Fiddle Faddle|Cracker Jack~popcornRTE
Microwave Popcorn~Orville Redenbacher's|Act II|Pop Secret|Jolly Time|Great Value|SkinnyPop|Angie's|Boomchickapop|Newman's Own~popcornMicro
Pork Rinds~Utz|Great Value|Baken-ETS|Pork King|Mac's|Lowrey's~porkRinds
Veggie Straws~Sensible Portions|Great Value|Good Health|From the Ground Up~veggieStraws
Pita Chips~Stacy's|Great Value|Tostitos|Food Should Taste Good|Simply7~pitaChips
Chocolate Bar~Hershey's|Cadbury|Milka|Tony's Chocolonely|ChocoLove|Endangered Species|Tcho|Hu|Ghirardelli|Lindt|Toblerone|Dove~chocolateBar
Boxed Chocolates~Russell Stover|Whitman's|Fannie May|Godiva|Lindt|Ferrero Rocher|Ghirardelli|Harry London|Dove~boxedChocolates
Peanut Butter Cups~Reese's|Justin's|UNREAL|YumEarth|Lily's|ChocZero|Theo|Hu~pbCups
Candy Bar~Snickers|Twix|3 Musketeers|Butterfinger|Milky Way|Baby Ruth|100 Grand|Heath|Take 5|PayDay|Almond Joy|Mounds|Whatchamacallit|Zagnut|Charleston Chew|5th Avenue~candyBar
Caramels~Werther's Original|Kraft|Brach's|Goetze's|Pearson's~caramels
Gummy Candy~Haribo|Albanese|Trolli|Black Forest|Welch's|Smart Sweets|Surf Sweets|YumEarth~gummy
Hard Candy~Jolly Rancher|Life Savers|Brach's|Werther's Original|Starlight Mints|LemonHeads|Atomic Fireballs~hardCandy
Chewy Candy~Starburst|Skittles|Milk Duds|Hi-Chew|Now and Later|Laffy Taffy|Mamba|Mentos|Tootsie Roll|Airheads~chewyCandy
Jelly Beans~Jelly Belly|Brach's|Starburst|Jolly Rancher|YumEarth|Haribo|Trolli~jellyBeans
Licorice~Twizzlers|Red Vines|Wiley Wallaby|Darrell Lea|Gustaf's|Good & Plenty~licorice
Lollipops~Charms|Dum Dums|Blow Pop|Tootsie Pops|Spangler|YumEarth|Chupa Chups|Jolly Rancher|Ring Pop~lollipop
Chewing Gum~Wrigley's|Extra|Orbit|Trident|Dentyne|5 Gum|Eclipse|Hubba Bubba|Bubble Yum|Juicy Fruit|Doublemint|Ice Breakers~gum
Mints~Tic Tac|Altoids|Ice Breakers|Halls|Ricola|Breath Savers~mints
Chocolate Chip Cookies~Chips Ahoy!|Great Value|Pepperidge Farm|Famous Amos|Grandma's|Keebler|Tate's Bake Shop|Simple Mills|EnjoyLife|Lenny & Larry's|Voortman~chocolateChipCookies
Sandwich Cookies~Oreo|Great Value|Hydrox|Newman's Own|Back to Nature|Late July|Mi-Del|Kinnikinnick~sandwichCookies
Cookies~Chips Ahoy!|Famous Amos|Grandma's|Pepperidge Farm|Keebler|Great Value|Tate's Bake Shop|Voortman|Simple Mills|Lenny & Larry's|Entenmann's|David's Cookies~cookies
Crackers~Wheat Thins|Triscuit|Great Value|Back to Nature|Simple Mills|Late July|Pepperidge Farm|Nabisco|Keebler|Sunshine|Premium|Blue Diamond~crackers
Cheese Crackers~Cheez-It|Goldfish|Great Value|Annie's|Back to Nature|Simple Mills|Late July~cheeseCrackers
Butter Crackers~Ritz|Great Value|Keebler Club|Back to Nature|Simple Mills|Late July~butterCrackers
Graham Crackers~Honey Maid|Great Value|Keebler|Annie's|Nabisco|Back to Nature|Simple Mills~grahamCrackers
Sandwich Crackers~Lance|Austin|Keebler|Great Value|Kellogg's|Handi-Snacks~sandwichCrackers
Snack Cakes~Hostess|Little Debbie|Entenmann's|Great Value|Tastykake|Mrs. Freshley's|Dolly Madison~snackCakes
Rice Cakes~Quaker|Great Value|Lundberg|Real Foods~riceCakes
Snack Mix~Chex Mix|Gardetto's|Great Value|Planters|Herr's|Utz~snackMix
Granola Bars~Nature Valley|Quaker|Great Value|Fiber One|Kashi|KIND|CLIF|Sunbelt Bakery|Nutri-Grain~granolaBars
Protein Bars~Pure Protein|Quest|CLIF Builder's|Nature Valley|One|MET-Rx|Think!|Grenade|Barebells|RxBar|Power Crunch|ZonePerfect|Atkins~proteinBars
Nuts~Planters|Great Value|Blue Diamond|Diamond|Emerald|Wonderful|Sahale Snacks|Fisher|Orchard Valley Harvest~nuts
Trail Mix~Great Value|Planters|Sahale Snacks|Orchard Valley Harvest|Fisher|Sun-Maid|Made In Nature|Woodstock~trailMix
Jerky~Jack Link's|Oberto|Duke's Smoked Meats|Tillamook Country Smoker|Old Wisconsin|Krave|Country Archer|Bridgford|Lorissa's~jerky
Meat Sticks~Slim Jim|Jack Link's|Old Wisconsin|Tillamook Country Smoker|Oberto|Klement's|Bridgford~meatSticks
Dried Fruit~Sun-Maid|Great Value|Ocean Spray|Made In Nature|Mariani|Woodstock|Dole|Fisher~driedFruit
`),
  "Breakfast & Coffee": D(`
Cereal~Kellogg's|General Mills|Post|Great Value|Quaker|Malt-O-Meal|Kashi|Cascadian Farm|Barbara's|EnviroKidz|Nature's Path|Three Wishes~coldCereal
Oatmeal~Quaker|Great Value|Nature Valley|Bob's Red Mill|McCann's|Better Oats|Kellogg's|Post|Umpqua~hotCereal
Grits~Quaker|Great Value|Jim Dandy|House-Autry|Palmetto Farms|Weisenberger Mill|Anson Mills~grits
Granola~Quaker|Nature Valley|Great Value|Kashi|KIND|Bob's Red Mill|Bear Naked|Purely Elizabeth|Back to Nature|Cascadian Farm|Nature's Path|Udi's~granola
Cereal Bars~Kellogg's Nutri-Grain|Quaker|Nature Valley|Fiber One|Great Value|Kashi|Sunbelt Bakery~cerealBars
Breakfast Biscuits~belVita|Great Value|Nature Valley|Nabisco|Kellogg's|Grandma's|McVitie's~breakfastBiscuits
Toaster Pastries~Pop-Tarts|Great Value|Cloverhill|Annie's|Immaculate~toasterPastries
Coffee~Folgers|Maxwell House|Dunkin'|Starbucks|Great Value|Lavazza|Peet's|Community Coffee|Eight O'Clock|Chock full o'Nuts|Café Bustelo|Gevalia|Caribou Coffee|Green Mountain|Death Wish|McCafé|Tim Hortons|Medaglia D'Oro|Segafredo|illy|Kicking Horse|Cameron's|Stone Street|Fresh Roasted Coffee|Tully's~groundCoffee
K-Cup Pods~Green Mountain|Dunkin'|Starbucks|Folgers|The Donut Shop|McCafé|Caribou Coffee|Peet's|Community Coffee|Café Bustelo|Tully's|Cinnabon|Swiss Miss|Great Value|Barista Prima|Twinings|Celestial Seasonings|Newman's Own Organics|Emeril's|Cameron's|Laughing Man|Tim Hortons|Gevalia~kcup
Instant Coffee~Folgers|Maxwell House|Nescafé|Nescafé Clásico|Mount Hagen|Starbucks VIA|Café Bustelo|Great Value|Taster's Choice|Douwe Egberts|Lavazza|Medaglia D'Oro|Jacobs|G7~instantCoffee
Tea~Lipton|Bigelow|Twinings|Celestial Seasonings|Great Value|Tazo|Harney & Sons|Stash|Yogi|Traditional Medicinals|Numi|PG Tips|Typhoo|Red Rose|Tetley|Good Earth|The Republic of Tea|Pukka|Choice Organic Teas|Rishi Tea|Ahmad Tea|Taylors of Harrogate|Salada~teaBags
-~Swiss Miss|Nestlé|Great Value|Ghirardelli|Land O Lakes|Dunkin'|Starbucks|Carnation|Stephen's|Godiva~cocoa
Donuts~Hostess|Little Debbie|Entenmann's|Great Value|Tastykake|Mrs. Freshley's|Dolly Madison~donuts
Muffins~Otis Spunkmeyer|Great Value|Little Bites|Entenmann's|Thomas'|Vachon|Mrs. Freshley's|Cloverhill|Hostess|Uncle Wally's~muffins
Bagels~Thomas'|Lender's|Great Value|Sara Lee|Arnold|Pepperidge Farm|Dave's Killer Bread|Franz|Oroweat|Brownberry|Nature's Own~bagels
`),
  "Pantry": D(`
Canned Vegetables~Green Giant|Del Monte|Libby's|Great Value|Bush's|Eden|Hunt's|Allens|Glory Foods|Trappey's|Margaret Holmes|Read|Veg-All~cannedVeg
Soup~Campbell's|Progresso|Great Value|Healthy Request|Amy's|Pacific Foods|Mrs. Grass|Bear Creek|Blount Fine Foods|Dinty Moore~soup
Chili~Hormel|Wolf Brand|Great Value|Campbell's|Hunt's|Dennison's|Stagg|Skyline|Brooks|Castleberry's~chili
-~Bush's|Goya|Great Value|Eden|Hunt's|B&M|Van Camp's|Trappey's|Hanover|Allen's|Luck's|Ranch Style|S & W~cannedBeans
Canned Fruit~Dole|Del Monte|Great Value|Libby's|Mott's|Goya|Ocean Spray|Welch's|S & W|Hanover~cannedFruit
Canned Pasta~Chef Boyardee|Great Value|Campbell's|SpaghettiOs~cannedPasta
Canned Tuna~StarKist|Bumble Bee|Chicken of the Sea|Great Value|Safe Catch|Wild Planet|Genova|Ortiz|Century~tuna
Canned Chicken~Swanson|Great Value|Valley Fresh|Hormel|Tyson|Libby's~cannedChicken
-~Swanson|Great Value|Campbell's|College Inn|Kitchen Basics|Pacific Foods|Better Than Bouillon|Imagine|Knorr|Orrington Farms~broth
Pasta~Barilla|Ronzoni|Great Value|Mueller's|De Cecco|Rana|Banza|Creamette|San Giorgio|Prince|Heartland|Da Vinci|Rummo|Garofalo|Colavita~pasta
-~Ragu|Prego|Great Value|Classico|Newman's Own|Bertolli|Hunt's|Francesco Rinaldo|Rao's|Carbone|Victoria|Lidia's|Cucina Antica|Paesana~pastaSauce
Rice~Ben's Original|Great Value|Mahatma|Goya|Carolina|Lundberg|Success|Zatarain's|Minute|Texmati|Riceland|River~rice
Macaroni & Cheese~Kraft|Great Value|Velveeta|Annie's|Back to Nature|Cracker Barrel|Banza~macCheese
Pasta Mix~Hamburger Helper|Great Value|Betty Crocker|Velveeta|Pasta Roni|Knorr|Tuna Helper|Chicken Helper~pastaMix
Rice Mix~Rice-A-Roni|Zatarain's|Great Value|Knorr|Near East|Mahatma|Vigo|Goya|River~riceMix
Taco Dinner Kit~Old El Paso|Great Value|Taco Bell|Ortega|McCormick~tacoKit
Peanut Butter~Jif|Skippy|Peter Pan|Great Value|Smucker's|Justin's|Teddie|Adams|Smart Balance|Once Again|Crazy Richard's|Barney Butter|Planters~peanutButter
-~Smucker's|Welch's|Great Value|Polaner|Kraft|Bonne Maman|Tiptree|Dickinson's|Santa Cruz|Crofter's|Knott's Berry Farm|Bionaturae|St. Dalfour|Hero~jam
Syrup~Pearl Milling Company|Mrs. Butterworth's|Great Value|Hungry Jack|Log Cabin|Smucker's|Torani|Monin|Cary's~syrup
Honey~Great Value|Busy Bee|Nature Nate's|Local Hive|Wholesome|GloryBee|Sue Bee|Y.S. Eco Bee Farms|Wee Bee~honey
Ketchup~Heinz|Great Value|Hunt's|French's|Sir Kensington's|Primal Kitchen|Annie's|Organicville~ketchup
Mustard~French's|Heinz|Great Value|Gulden's|Grey Poupon|Sir Kensington's|Primal Kitchen|Annie's|Koops'|Inglehoffer~mustard
Mayonnaise~Hellmann's|Duke's|Great Value|Kraft|Miracle Whip|Primal Kitchen|Sir Kensington's|Annie's|Chosen Foods|Kewpie|Blue Plate~mayo
Pickles~Vlasic|Claussen|Great Value|Mt. Olive|B&G|Heinz|Grillo's|Ba Tempte|Famous Dave's|Hengstenberg's|Hausbeck~pickles
Olives~Lindsay|Great Value|Goya|Pearl|Mezzetta|Star|Divina|Mario Camacho Foods|Krinos|Cento~olives
-~Frank's RedHot|Cholula|Tapatío|Texas Pete|Tabasco|Louisiana|Crystal|Huy Fong Foods|Burman|El Yucateco|Valentina|Da Bomb|Secret Aardvark~hotSauce
Barbecue Sauce~Sweet Baby Ray's|Kraft|Bull's-Eye|Great Value|KC Masterpiece|Hunt's|Stubb's|Jack Daniel's|Guy Fieri~bbqSauce
Steak Sauce~A1|Heinz|Lea & Perrins|Great Value|Peter Luger|Dale's|Cattlemen's~steakSauce
Soy Sauce~Kikkoman|La Choy|Great Value|Lee Kum Kee|Thai Kitchen|House of Tsang|Wan Ja Shan|Yamasa|Sempio~soySauce
-~Hidden Valley|Kraft|Great Value|Newman's Own|Ken's|Wish-Bone|Bolthouse Farms|Primal Kitchen|Annie's|Brianna's|Marzetti|Tessemae's|Girard's~dressing
Vinegar~Heinz|Great Value|Colavita|Pompeian|Bragg|Spectrum|Star|Lucini|Filippo Berio|Mizkan|Marukan|Kikkoman|Nakano~vinegar
Olive Oil~Great Value|Pompeian|Filippo Berio|Carapelli|Star|California Olive Ranch|Bertolli|La Espagnola|Colavita|Spectrum|Lucini~oliveOil
Cooking Oil~Great Value|Crisco|Wesson|Nutiva|Chosen Foods|Mazola|LouAna|Hain~oil
Cooking Spray~Pam|Great Value|Crisco|Chosen Foods|Smart Balance|Vegalene~cookingSpray
Shortening~Crisco|Great Value|Spectrum|Nutiva~shortening
Flour~Pillsbury|Gold Medal|Great Value|King Arthur|Bob's Red Mill|Betty Crocker|Swans Down|Softasilk|Arrowhead Mills|Namaste|White Lily|Martha White~flour
Sugar~Domino|Great Value|C&H|Imperial|Wholesome|Florida Crystals|Sugar In The Raw|Stevia In The Raw~sugar
-~McCormick|Great Value|Lawry's|Simply Organic|Badia|Spice Islands|Weber|Durkee|Frontier Co-op|The Spice Hunter|Tony Chachere's|Old Bay|Mrs. Dash|Goya|Sadaf~spices
Salt~Morton|Great Value|Diamond Crystal|Lawry's|Redmond Real Salt|Himalayan Chef|La Baleine|Windsor~salt
Cake Mix~Duncan Hines|Betty Crocker|Pillsbury|Great Value|Simple Mills|Ghirardelli|Krusteaz|King Arthur~cakeMix
Brownie Mix~Duncan Hines|Betty Crocker|Ghirardelli|Great Value|Pillsbury|Simple Mills|Krusteaz~brownieMix
Baking Chips~Nestlé Toll House|Ghirardelli|Hershey's|Great Value|Guittard|Lily's|EnjoyLife|Callebaut~bakingChips
Marshmallows~Jet-Puffed|Great Value|Smucker's|Kraft|Campfire|Doumak~marshmallows
Stuffing~Pepperidge Farm|Great Value|Stove Top|Manischewitz|Mrs. Cubbison's~stuffing
Instant Potatoes~Idahoan|Betty Crocker|Great Value|Hungry Jack|Idaho Spuds|Stove Top~instantPotato
Dried Beans~Goya|Camellia|Great Value|Bob's Red Mill|Hurst's HamBeens|Rancho Gordo|Arrowhead Mills|Augason Farms~dryBeans
Tortillas~Mission|Great Value|Guerrero|Tortillaland|Tia Rosa|Ortega|Old El Paso|La Tortilla Factory|Maya|Chi-Chi's~tortillas
-~McCormick|Campbell's|Great Value|Heinz|Knorr|Famous Dave's|Lawry's|Pacific Foods~gravy
Baking Powder~Clabber Girl|Arm & Hammer|Davis|Rumford|Great Value|Bob's Red Mill~leavening
Baking Soda~Arm & Hammer|Great Value|Bob's Red Mill|Frontier Co-op|Pure~leavening
Vanilla Extract~McCormick|Great Value|Nielsen-Massey|Simply Organic|Spice Islands|Watkins|Frontier Co-op|Heilala|Taylor & Colledge|LorAnn~extract
Almond Extract~McCormick|Great Value|Nielsen-Massey|Simply Organic|Spice Islands|Watkins|LorAnn~extractNutty
Corn Starch~Argo|Great Value|Clabber Girl|Hodgson Mill|Bob's Red Mill~starch
Yeast~Fleischmann's|Red Star|Great Value|SAF|Bob's Red Mill~yeast
-~Hershey's|Great Value|Ghirardelli|Droste|Valrhona|Navitas|Callebaut~cocoaPowder
Corn Syrup~Karo|Great Value|Wholesome|Argo~cornSyrup
Food Coloring~McCormick|Wilton|Great Value|AmeriColor|Chefmaster|Betty Crocker~foodColoring
Sprinkles~Wilton|Great Value|Betty Crocker|McCormick|LorAnn~sprinkles
Molasses~Grandma's|Great Value|Brer Rabbit|Plantation|Golden Barrel|Wholesome~molasses
Gelatin~Jell-O|Great Value|Knox|Royal~gelatin
Pudding~Jell-O|Great Value|Royal|Snack Pack|Kozy Shack|Hunt's|My-T-Fine~pudding
Milk~Pet|Carnation|Great Value|Eagle Brand|Magnolia|Nestlé|Meyenberg|La Lechera~cannedMilk
`),
  "Bakery": D(`
Bread~Wonder|Nature's Own|Great Value|Sara Lee|Arnold|Pepperidge Farm|Oroweat|Brownberry|Dave's Killer Bread|Franz|Sunbeam|Bunny|Cobblestone Bread Co.|King's Hawaiian|Stroehmann~bread
Buns~Ball Park|Great Value|Wonder|Sara Lee|Nature's Own|Arnold|Pepperidge Farm|Stroehmann|Martin's|King's Hawaiian|Bunny|Oroweat~buns
English Muffins~Thomas'|Great Value|Sara Lee|Bays|Arnold|Wolferman's|Rudi's|Dave's Killer Bread|Franz|Brownberry~englishMuffins
Flatbread~Stonefire|Great Value|Mission|Toufayan|Kontos|Joseph's|Atoria's|Damascus|New York Bakery|La Brea Bakery~flat
Pie~Sara Lee|Great Value|Mrs. Smith's|Edwards|Marie Callender's|Claim Jumper|Dutch Farms|Table Talk|Bama|Wick's|Borden|Pillsbury|Tastykake|Entenmann's|Little Debbie~pie
Cinnamon Rolls~Pillsbury|Great Value|Cinnabon|Rhodes|Immaculate Baking|Annie's|King's Hawaiian|Little Debbie|Mrs. Freshley's|Cloverhill|Dolly Madison|Sara Lee~rolls
Coffee Cake~Sara Lee|Great Value|Entenmann's|Little Debbie|Mrs. Freshley's|Cloverhill|Tastykake|Duncan Hines|Betty Crocker|Upper Crust Bakery~coffeeCake
Croissants~Great Value|Sara Lee|Dufour|Villagio|La Brea Bakery|Pillsbury|Cloverhill|Mrs. Freshley's|Brioche Pasquier~croissant
Cookies~Great Value|Lofthouse|David's Cookies|Cheryl's|Uncle Wally's|Cloverhill|Mrs. Freshley's|Sara Lee|Entenmann's~cookies
Bagels~Thomas'|Lender's|Great Value|Sara Lee|Arnold|Pepperidge Farm|Dave's Killer Bread|Franz|Oroweat~bagels
Donuts~Hostess|Little Debbie|Entenmann's|Great Value|Tastykake|Mrs. Freshley's|Dolly Madison~donuts
Muffins~Otis Spunkmeyer|Great Value|Little Bites|Entenmann's|Thomas'|Vachon|Mrs. Freshley's|Cloverhill|Hostess~muffins
`),
  "Meat & Seafood": D(`
Chicken~Tyson|Great Value|Perdue|Foster Farms|Sanderson Farms|Pilgrim's|Bell & Evans|Just BARE|Coleman Natural|Applegate|Gold'n Plump|HarvestLand|Miller Poultry~poultry
Turkey~Butterball|Jennie-O|Great Value|Honeysuckle White|Shady Brook Farms|Norbest|Hillshire Farm|Cargill|The Turkey Store|Zacky Farms|Foster Farms|Perdue|Boar's Head|Applegate|Wellshire~poultry
Beef~Great Value|Certified Angus Beef|Sterling Silver|Swift|National Beef|Tyson Fresh Meats|Harris Ranch|Meyer Natural Foods|Niman Ranch|44 Farms|Creekstone Farms|Greater Omaha|Snake River Farms|Brandt Beef|Coleman Natural|Kansas City Steak Company|Omaha Steaks|White Oak Pastures|Thousand Hills|Teton Waters Ranch|Force of Nature|D'Artagnan~beef
Pork~Smithfield|Tyson|Great Value|Hormel|Farmland|Hatfield|Eckrich|Kretschmar|Hillshire Farm|Jones|Pederson's|Niman Ranch|Coleman Natural|D'Artagnan|Heritage Foods|Snake River Farms|Hempler's|Wellshire|Applegate|Compart Family Farms~pork
Ham~Hormel|Smithfield|Great Value|Hillshire Farm|Oscar Mayer|Farmland|Hatfield|Eckrich|Kretschmar|Boar's Head|Cook's|John Morrell|Armour|Pederson's|Wellshire|Applegate|Niman Ranch|Dietz & Watson|Thumann's|Land O'Frost|Burgers' Smokehouse|Broadbent|Edwards|Sugardale|Kentucky Legend|Nueske's~ham
Salmon~Great Value|Wild Alaskan|Trident Seafoods|SeaBest|Aqua Star|Verlasso|Hidden Fjord|Copper River|Orca Bay|Fishpeople|Vital Choice~salmon
Shrimp~Great Value|SeaBest|Aqua Star|Wild American Shrimp|Gorton's|SeaPak|Red Lobster|Chicken of the Sea|Bumble Bee|High Liner|Northern Catch|Waterfront Bistro|Censea|Pescanova~shrimp
Fish~Great Value|Gorton's|SeaBest|Aqua Star|High Liner|Van de Kamp's|Mrs. Paul's|SeaPak|Trident Seafoods|Fishpeople|Bumble Bee|Fisher Boy|Sea Cuisine|Morey's~fish
Tilapia~Great Value|SeaBest|Aqua Star|High Liner|Gorton's|Fishpeople|Regal Springs|Morey's|SeaPak~fish
Scallops~Great Value|SeaBest|Aqua Star|Clearwater|Sea Watch|Gorton's|SeaPak|High Liner|Bumble Bee|Censea|Pescanova|Wanchese Fish Company~scallops
Crab~Great Value|Phillips|Chicken of the Sea|Bumble Bee|Louis Kemp|Crab Classic|Trans-Ocean|SeaPak|Aqua Star|High Liner|Censea|Orca Bay~crab
Meatballs~Great Value|Aidells|Johnsonville|Foster Farms|Cooked Perfect|Rosina|Mama Mancini's|Rana|Carando|Bob Evans|Hillshire Farm|Farm Rich|Smithfield|Tyson|Butterball|Michael Angelo's|Beyond Meat|Impossible|Lightlife|Field Roast|MorningStar Farms|Gardein|Quorn~meatballs
`),
  "Frozen": D(`
Ice Cream~Great Value|Blue Bell|Ben & Jerry's|Häagen-Dazs|Breyers|Edy's|Dreyer's|Tillamook|Blue Bunny|Talenti|Turkey Hill|Friendly's|Halo Top|Enlightened|Rebel|Arctic Zero|NadaMoo|So Delicious|Oatly|Yasso|Jeni's|Graeter's|Hudsonville|Schwan's|Mayfield|Kemps|Baskin-Robbins|Alden's|Organic Valley|Coconut Bliss~iceCream
-~Great Value|Magnum|Klondike|Popsicle|Outshine|Yasso|Good Humor|Drumstick|Blue Bell|Halo Top|Fudgsicle|Creamsicle|Nestlé|Dreyer's|Breyers|Toll House|Bomb Pop|Fla-Vor-Ice|Luigi's|Wyler's|Twix|Snickers|Oreo|Enlightened|GoodPop|Helados Mexico~frozenTreats
Pizza~Great Value|DiGiorno|Red Baron|Totino's|Tony's|Tombstone|Jack's|Freschetta|California Pizza Kitchen|Amy's|Palermo's|Screamin' Sicilian|Home Run Inn|Newman's Own|Kashi|Sabatasso's|Alex's|Stouffer's|Caulipower|Banza|Brick Oven|Elio's|Celeste|Giordano's|Lou Malnati's~frozenPizza
-~Great Value|Birds Eye|Green Giant|Cascadian Farm|PictSweet|Woodstock|Hanover|C&W|Eden|Nature's Touch|Stahlbush Island Farms~frozenVeg
-~Great Value|Dole|Wyman's|Cascadian Farm|Woodstock|Stahlbush Island Farms|PictSweet|Eden|Nature's Touch|Welch's|Sunkist|Goya|Birds Eye~frozenFruit
-~Stouffer's|Lean Cuisine|Healthy Choice|Marie Callender's|Banquet|Hungry-Man|Swanson|Boston Market|Gardein|Smart Ones|Birds Eye|Michelina's|Amy's|Evol|Saffron Road|Maya Kaimal|P.F. Chang's|Bibigo|InnovAsian|Tai Pei|Michael Angelo's|Rao's|Devour|Bertolli|On-Cor|Morton|Great Value|Fernando's|Jose Ole|El Monterey|Don Miguel|Ruiz|Tina's~frozenMeal
-~Great Value|Jimmy Dean|Bob Evans|Tyson|Oscar Mayer|Johnsonville|Pearl Milling Company|Mrs. Butterworth's|Eggo|Van's|Kashi|Birch Benders|Cascadian Farm|Simple Mills|Impossible|Beyond Meat|MorningStar Farms|Dr. Praeger's|Alex's|Ore-Ida|Pillsbury|Jones|Hillshire Farm~frozenBreakfast
-~Tyson|Great Value|Perdue|Foster Farms|Pilgrim's|Sanderson Farms|Bell & Evans|Just BARE|Applegate|Beyond Meat|Impossible|MorningStar Farms|Gardein|Quorn|Field Roast|Hillshire Farm|Jimmy Dean|Wellshire|Coleman Natural~frozenChicken
-~Ore-Ida|Great Value|McCain|Alexia|Birds Eye|Cascadian Farm|Cavendish|Arby's|Green Giant|Strong Roots|Farm Rich~frozenPotato
-~Sara Lee|Great Value|Edwards|Mrs. Smith's|Marie Callender's|Duncan Hines|Pillsbury|Betty Crocker|The Cheesecake Factory|Junior's|Eli's|David's Cookies|Otis Spunkmeyer|Jon Donaire|Athens|Claim Jumper|Sweet Street|Chef Pierre~frozenDessert
-~Great Value|Farm Rich|Tyson|TGI Fridays|Applegate|Alex's|Bagel Bites|Totino's|State Fair|Jose Ole|El Monterey|Ruiz|Pagoda|Tai Pei|InnovAsian|Bibigo|Aidells|Johnsonville|Hillshire Farm|Cook's|Bob Evans|Foster Farms|Bridgford|White Castle|Sweet Earth|MorningStar Farms|Gardein|Quorn|Dr. Praeger's|SuperPretz|Nathan's Famous|Boar's Head|Hormel|Armour|Sugardale~frozenApps
`),
  "Drinks": D(`
-~Coca-Cola|Pepsi|Dr Pepper|Great Value|RC Cola|Faygo|Shasta|Big Red|Zevia|Virgil's~cola
-~Sprite|7UP|Starry|Great Value|Faygo|Shasta|Sierra Mist|Zevia|Seagram's~lemonLime
-~Mountain Dew|Sun Drop|Mello Yello|Great Value|Surge|Kickstart|Faygo|Zevia~citrusSoda
-~A&W|Mug|Barq's|Dad's|IBC|Great Value|Virgil's|Sprecher|Frostie|Hires|Sioux City|Stewart's~rootBeer
-~Canada Dry|Schweppes|Seagram's|Great Value|Vernors|Ale-8-One|Buffalo Rock|Fever-Tree|Q Mixers|Zevia~gingerAle
-~Fanta|Sunkist|Crush|Minute Maid|Great Value|Nehi|Faygo|Shasta|Slice~fruitSoda
-~Gatorade|Powerade|Great Value|BODYARMOR|Propel|Prime|Vitaminwater|Sqwincher|All Sport|BioSteel|Nuun|Liquid I.V.|DripDrop|LMNT|Pedialyte|Core Power~sportsDrink
-~Red Bull|Monster|Rockstar|Bang|Celsius|Reign|Great Value|5-hour Energy|Ghost|Alani Nu|Zoa|Rip It|Full Throttle|NOS|3D Energy|C4 Energy|G Fuel|Zipfizz|Hiball|V8 +Energy|Guru~energyDrink
-~Aquafina|Dasani|Great Value|Pure Life|Fiji|Smartwater|Evian|Deer Park|Ice Mountain|Zephyrhills|Ozarka|Poland Spring|Core Hydration|Essentia|Life WTR|Hint|Icelandic Glacial|Topo Chico|Liquid Death|Mountain Valley|Penta|Real|Saratoga|Primo|Crystal Geyser|Alhambra|Arrowhead|Eternal|Perfect Hydration|Flow|Acqua Panna|Gerolsteiner|VOSS|Niagara|Kirkland Signature~water
-~LaCroix|Bubly|Great Value|Spindrift|Polar|Aha|Perrier|San Pellegrino|Topo Chico|Canada Dry|Schweppes|Waterloo|Zevia|Saratoga|Core Hydration|Hint|Mountain Valley|Fever-Tree|Q Mixers|Poland Spring|Vintage|Clear American|Clearly Canadian|Hal's New York|White Rock|Fentimans~sparklingWater
Juice~Tropicana|Minute Maid|Simply|Great Value|Florida's Natural|Dole|Naked|Bolthouse Farms|V8|Langers|Martinelli's|Mott's|Welch's|Ocean Spray|Seneca|R.W. Knudsen|Apple & Eve|Natalie's|Uncle Matt's|Evolution Fresh|Suja|Sunkist~juice
-~Capri Sun|Hi-C|Great Value|Kool-Aid|Minute Maid|Honest Kids|Tampico|Flavor Aid|Juicy Juice|Apple & Eve|Ocean Spray|Mott's|Welch's|SunnyD|Yoo-hoo|Dole|Libby's|Snapple|Hawaiian Punch|Langers|Old Orchard|Seneca~juiceBox
-~Lipton|Great Value|Snapple|Arizona|Pure Leaf|Gold Peak|Sweet Leaf|Tazo|Brisk|Red Diamond|Milo's|Turkey Hill|Tetley|Steaz|Peace Tea|Honest~rtdTea
-~Starbucks|Dunkin'|Great Value|Califia Farms|International Delight|La Colombe|High Brew|Java Monster|Chameleon|Stok|Super Coffee|Chobani|Silk|Coffee-mate|Wandering Bear|Peet's~rtdCoffee
Coconut Water~Vita Coco|Zico|Great Value|Harmless Harvest|C2O|Coco Libre|Taste Nirvana|Zola|Copra|Amy & Brian Naturals~coconutWater
Vegetable Juice~V8|Great Value|Campbell's|Mr. & Mrs. T|Bolthouse Farms|Naked|Suja|R.W. Knudsen|Lakewood~vegJuice
-~Minute Maid|Simply|Great Value|Tropicana|Newman's Own|Sunkist|Turkey Hill|Calypso|Hubert's|Natalie's|Uncle Matt's|Country Time~lemonade
-~GT's|Great Value|Health-Ade|KeVita|Brew Dr. Kombucha|Humm Kombucha|Kombucha Wonder Drink|Remedy|Rowdy Mermaid|Buchi|Nova Easy Kombucha|Better Booch~kombucha
`),
  "Fresh Produce": D(`
-~Stemilt|Domex Superfresh|Rainier Fruit|Chelan Fresh|Blue Bird|CMI|Crunch Pak|Riveridge|Dole|Del Monte~treeFruit
-~Sunkist|Halos|Cuties|Wonderful|Duda Farm Fresh Foods|Bee Sweet Citrus|Paramount Citrus|Sun Pacific|Limoneira|Dole~citrus
-~Driscoll's|Naturipe|California Giant|Wish Farms|Dole|Del Monte|Boskovich|Earthbound Farm|Ocean Spray|Sun Belle~berries
-~Sun World|Grapery|Wonderful|Dole|Del Monte|Four Star Fruit|Columbine Vineyards|Boskovich|Giumarra~grapes
-~Del Monte|Dole|Lipman|DiMare|Duda Farm Fresh Foods|Leger & Son|Boskovich|D'Arrigo|Andy Boy|Tanimura & Antle~melons
-~Chiquita|Dole|Del Monte|Fyffes|Organics Unlimited|Coliman|Sun Pacific|Melissa's Produce|Frieda's|Boskovich|D'Arrigo|Giumarra~tropical
-~Fresh Express|Earthbound Farm|Taylor Farms|Ready Pac|Eat Smart|Markon|Dole|Tanimura & Antle|Ocean Mist Farms|Mann Packing|Duda Farm Fresh Foods|Boskovich|Josie's Organics|Green Giant Fresh|Church Brothers|NewStar Fresh|Grimmway Farms~saladGreens
-~Green Giant Fresh|Dole|Del Monte|Taylor Farms|Bolthouse Farms|Grimmway Farms|Cal-Organic|Mann Packing|Ocean Mist Farms|Tanimura & Antle|Duda Farm Fresh Foods|Boskovich|Markon|Church Brothers|NewStar Fresh|Andy Boy|Giumarra|Ready Pac|Earthbound Farm|Fresh Express~vegA
-~Shenandoah Growers|North Shore Living Herbs|Simply Herbs|Boskovich|D'Arrigo|Frieda's|Melissa's Produce|Gotham Greens|Gourmet Garden~herbs
`),
  "Paper & Cleaning": D(`
Paper Towels~Bounty|Great Value|Brawny|Viva|Sparkle|Scott|Seventh Generation|Marcal|Presto!|Kirkland Signature|Georgia-Pacific|Envision~paperTowels
Bath Tissue~Charmin|Angel Soft|Quilted Northern|Cottonelle|Scott|Great Value|Seventh Generation|Kirkland Signature|Georgia-Pacific|Presto!|Marcal|Caboo|Reel|PlantPaper|Who Gives a Crap~bathTissue
Facial Tissue~Kleenex|Puffs|Great Value|Angel Soft|Scott|Seventh Generation|Kirkland Signature|Georgia-Pacific|Surpass|Fiora|Marcal~facialTissue
-~Dixie|Great Value|Hefty|Chinet|Solo|Kirkland Signature|Member's Mark|Seventh Generation|Georgia-Pacific|Eco-Products|World Centric|Repurpose~paperPlates
Trash Bags~Glad|Hefty|Great Value|Member's Mark|Kirkland Signature|Husky|simplehuman|HoldOn|Reli.|Stout|Inteplast|Webster Industries|Heritage|Poly-America|Aluf Plastics~trashBags
Laundry Detergent~Tide|Gain|Persil|Arm & Hammer|Great Value|All|Cheer|Era|Purex|Seventh Generation|Dreft|OxiClean|Zout|Mrs. Meyer's|Method|Grab Green|Dropps|Tru Earth|Babyganics|ECOS|Nellie's|Molly's Suds|Charlie's Soap|Biokleen|Rockin' Green~laundryDetergent
Fabric Softener~Downy|Snuggle|Great Value|Gain|Tide|Bounce|Seventh Generation|Mrs. Meyer's|Method|Babyganics|Attitude|Grab Green|Dropps|Woolite~fabricCare
Dish Soap~Dawn|Palmolive|Great Value|Ajax|Joy|Ivory|Seventh Generation|Mrs. Meyer's|Method|Ecover|ECOS|Babyganics|Attitude|Better Life|Lemi Shine~dishSoap
Dishwasher Detergent~Finish|Cascade|Great Value|Seventh Generation|Mrs. Meyer's|Method|Ecover|Lemi Shine|Grab Green|Dropps|Blueland|Better Life|Affresh|Glisten~dishwasher
-~Clorox|Lysol|Great Value|Pine-Sol|Mr. Clean|Windex|Scrubbing Bubbles|Fantastik|Formula 409|Simple Green|Method|Mrs. Meyer's|Seventh Generation|Soft Scrub|Comet|Ajax|Bar Keepers Friend|Bon Ami|Zep|Krud Kutter|Goo Gone|Goof Off|Rejuvenate|Weiman|Drano|Liquid-Plumr|CLR|Lime-A-Way|Wet & Forget|Rust-Oleum~cleaners
Wipes~Lysol|Clorox|Great Value|Windex|Scrubbing Bubbles|Mr. Clean|Seventh Generation|Method|Babyganics|Nice-Pak|Diversey|Boardwalk~wipes
-~Scrub Daddy|Scrub Mommy|Great Value|Scotch-Brite|3M|S.O.S|Brillo|Mr. Clean|Libman|Swiffer|E-Cloth|Norwex|Full Circle|Skoy|If You Care|Twist|Totally Bamboo|Wet-It~sponges
-~Febreze|Glade|Air Wick|Renuzit|Great Value|Yankee Candle|Bath & Body Works|Lysol|OdoBan|Zero Odor|Mrs. Meyer's|Method|Fresh Wave|Moso|Bad Air Sponge|Gonzo|Citrus Magic|Bright Air|WoodWick|Capri Blue|Paddywax|Voluspa|Nest|Votivo|Homesick|Bridgewater|Archipelago|Thymes|Illume|Tyler Candle|Goose Creek~airFresh
-~Ziploc|Glad|Hefty|Great Value|Reynolds Wrap|Reynolds|Diamond|Saran|Kirkland Signature|Member's Mark|Presto!|If You Care|Natural Value|Eco-Products|World Centric|Repurpose|Stasher|Bee's Wrap|Rubbermaid|Pyrex|Anchor Hocking|Snapware|Glasslock|Ello~foodStorage
`),
  "Personal Care": D(`
Shampoo~Pantene|Head & Shoulders|Dove|Herbal Essences|Garnier|L'Oréal Paris|TRESemmé|Suave|OGX|Aussie|Nexxus|Aveeno|Neutrogena|Redken|Paul Mitchell|Bed Head|Living Proof|Briogeo|SheaMoisture|Mielle|Maui Moisture|Not Your Mother's|Hask|Kristin Ess|Function of Beauty|Amika|Pureology|Camille Rose|Vegamour|Pura D'or|Maple Holistics|ArtNaturals|Dr. Bronner's|Burt's Bees|Acure|Andalou|Avalon Organics|Desert Essence|Giovanni|Pacifica|Raw Sugar|Great Value|Equate~shampoo
Conditioner~Pantene|Dove|Herbal Essences|Garnier|L'Oréal Paris|TRESemmé|Suave|OGX|Aussie|Nexxus|Aveeno|Redken|Paul Mitchell|Bed Head|Living Proof|Briogeo|SheaMoisture|Mielle|Maui Moisture|Not Your Mother's|Hask|Kristin Ess|Function of Beauty|Amika|Pureology|Camille Rose|Pura D'or|Maple Holistics|ArtNaturals|Burt's Bees|Acure|Andalou|Avalon Organics|Desert Essence|Giovanni|Pacifica|Raw Sugar|Great Value|Equate~conditioner
Body Wash~Dove|Nivea|Olay|Old Spice|Dial|Irish Spring|Caress|Suave|Naturium|SheaMoisture|Aveeno|Neutrogena|Burt's Bees|Eucerin|Cetaphil|Dr. Bronner's|Everyone|Alaffia|Tree to Tub|Beekman 1802|Softsoap|Zest|Great Value|Equate~bodyWash
Bar Soap~Dove|Ivory|Dial|Irish Spring|Zest|Caress|Lever 2000|Softsoap|Pears|Bee & Flower|South of France|Dr. Bronner's|Dr. Woods|Kirk's|Yardley London|Neutrogena|Basis|Aveeno|Burt's Bees|Olay|Great Value|Equate~barSoap
Deodorant~Dove|Degree|Secret|Old Spice|Right Guard|Suave|Speed Stick|Mitchum|Ban|Tom's of Maine|Schmidt's|Native|Arm & Hammer|AXE|Mennen|Sure|Dove Men+Care|Megababe|Curie|Hume Supernatural|Each & Every|Beekman 1802|Alaffia|Weleda|Salt & Stone|Harry's|Brickell|Jack Black|Cremo|Art of Sport|Dollar Shave Club|Great Value|Equate~deodorant
Toothpaste~Crest|Colgate|Sensodyne|Tom's of Maine|Arm & Hammer|Parodontax|Aquafresh|Close-Up|AIM|Burt's Bees|Hello|Dr. Bronner's|TheraBreath|Rembrandt|Jason|Great Value|Equate~toothpaste
-~Oral-B|Colgate|Crest|Philips Sonicare|Reach|GUM|DenTek|Listerine|Act|Plackers|Waterpik|Tom's of Maine|Dr. Tung's|Great Value|Equate|Quip|Hum by Colgate~oralCare
Body Lotion~Nivea|Olay|Vaseline|Eucerin|Cetaphil|Lubriderm|Aveeno|Curél|Dove|St. Ives|Suave|Palmer's|Jergens|Neutrogena|Gold Bond|CeraVe|Naturium|Burt's Bees|Weleda|Alaffia|Great Value|Equate~lotion
Sunscreen~Coppertone|Banana Boat|Neutrogena|Hawaiian Tropic|La Roche-Posay|CeraVe|EltaMD|Aveeno|Bull Frog|Australian Gold|Sun Bum|Badger|Blue Lizard|Thinksport|Babyganics|Nivea|Alba Botanica|Olay|Vanicream|Colorescience|Supergoop!|Salt & Stone|Equate|Great Value~sunscreen
-~Gillette|Schick|Bic|Harry's|Dollar Shave Club|Edge|Barbasol|eos|Venus|Braun|Philips Norelco|Panasonic|Remington|Andis|Wahl|King of Shaves|Cremo|Jack Black|Art of Sport|Billie|Flamingo|Leaf Shave|Supply|OneBlade|Equate|Great Value~shave
-~TRESemmé|L'Oréal Paris|Garnier|Pantene|OGX|Not Your Mother's|Kenra|Big Sexy Hair|Matrix|Redken|Paul Mitchell|Bed Head|Moroccanoil|Ouai|Pattern Beauty|Briogeo|Camille Rose|SheaMoisture|Mielle|Amika|Bumble and bumble|Kristin Ess|Olaplex|K18|Batiste|Living Proof|Ghd|Dyson|Great Value|Equate~hairCare
-~Maybelline New York|L'Oréal Paris|e.l.f.|NYX Professional Makeup|Revlon|CoverGirl|Wet n Wild|Milani|Physicians Formula|Essence|Rimmel London|Almay|L.A. Girl|BH Cosmetics|ColourPop|Morphe|Juvia's Place|Black Radiance|IMAN|Essie|OPI|Sally Hansen|Real Techniques|Great Value~cosmetics
-~Poise|Always|Kotex|U by Kotex|Tampax|Playtex|Flex|Saalt|Ruby Love|Cora|Organyc|Stayfree|Carefree|Seventh Generation|The Honey Pot|L.|Rael|Equate|Great Value~femCare
-~Q-tips|Great Value|Swisspers|Cottonelle|Equate|Organyc|Seventh Generation~cotton
`),
  "Pharmacy": D(`
Pain Relief~Tylenol|Advil|Aleve|Bayer|Motrin|Excedrin|Midol|Equate|BC|Goody's|Panadol|St. Joseph|Ecotrin|Bufferin|Anacin|Doan's|Genexa|Hyland's|Little Remedies|GoodSense|HealthA2Z|Basic Care|Kirkland Signature|Member's Mark~painRelief
Cold & Cough~Mucinex|Robitussin|NyQuil|DayQuil|Vicks|Theraflu|Coricidin|Delsym|Sudafed|Triaminic|Dimetapp|Zicam|Airborne|Chloraseptic|Boiron|Hyland's|Maty's|Zarbee's|Little Remedies|Equate|GoodSense|HealthA2Z|Basic Care|Kirkland Signature|Member's Mark~coldMedicine
Cold Medicine~Ricola|Halls|Cepacol|Luden's|Fisherman's Friend|Vicks|Chloraseptic|Traditional Medicinals|Zarbee's|Equate|GoodSense|Kirkland Signature~coldMedicine
Allergy~Claritin|Zyrtec|Allegra|Benadryl|Xyzal|Flonase|Nasacort|Astepro|Zaditor|Alaway|Pataday|Afrin|NeilMed|Ayr|Little Remedies|Hyland's|Equate|GoodSense|HealthA2Z|Basic Care|Kirkland Signature|Member's Mark~allergy
Eye Drops~Refresh|Systane|Visine|Clear Eyes|Rohto|Bausch + Lomb|Alcon|TheraTears|GenTeal|Blink|Zaditor|Alaway|Similasan|Equate|GoodSense|Kirkland Signature~eyeDrops
Vitamins~Centrum|One A Day|Nature Made|Nature's Bounty|GNC|Spring Valley|Equate|Kirkland Signature|Member's Mark|Nature's Way|Now Foods|Solgar|Rainbow Light|Garden of Life|MegaFood|New Chapter|SmartyPants|vitafusion|L'il Critters|Flintstones|Emergen-C|Airborne|Zarbee's|MaryRuth's|Natrol|Osteo Bi-Flex|Move Free|Culturelle|Align|Benefiber|Metamucil|Citrucel|Fiber Choice|Schiff~vitamins
Digestive Health~Tums|Rolaids|Pepto-Bismol|Mylanta|Maalox|Gaviscon|Nexium|Prilosec|Prevacid|Pepcid|Tagamet|Axid|Gas-X|Phazyme|Beano|Imodium|Kaopectate|Dulcolax|Ex-Lax|Senokot|Colace|Miralax|Milk of Magnesia|Phillips'|Citrucel|Metamucil|Benefiber|Fiber Choice|Culturelle|Align|Florastor|Renew Life|Garden of Life|Equate|GoodSense|HealthA2Z|Basic Care|Kirkland Signature|Member's Mark~digestive
First Aid~Band-Aid|Neosporin|Johnson & Johnson|Curad|3M|Nexcare|Medline|Dynarex|Bactine|Polysporin|After Bite|Equate|GoodSense|HealthA2Z|Basic Care|Kirkland Signature|Member's Mark~firstAid
`),
  "Baby": D(`
-~Pampers|Huggies|Luvs|Great Value|Parent's Choice|Honest|Seventh Generation|Babyganics|Bambo Nature|Eco by Naty|Coterie|Millie Moon|Hello Bello|Parasol|Cuties|Kirkland Signature|Member's Mark~diapers
-~Pampers|Huggies|Great Value|Parent's Choice|Seventh Generation|Honest|Hello Bello|Kirkland Signature|Member's Mark|Goodnites|Cuties|Parasol~diapers
-~Pampers|Huggies|WaterWipes|Great Value|Parent's Choice|Honest|Babyganics|Seventh Generation|Mustela|Cetaphil Baby|Burt's Bees Baby|Hello Bello|Coterie|Millie Moon|Kirkland Signature|Member's Mark|Bambo Nature|Eco by Naty~babyWipes
Baby Formula~Enfamil|Similac|Gerber Good Start|Bobbie|Kendamil|Earth's Best|Happy Baby|ByHeart|Bubs|Parent's Choice|Great Value|Kirkland Signature|Member's Mark|Bright Beginnings|Baby's Only Organic|Kabrita~formula
-~Gerber|Beech-Nut|Happy Baby|Earth's Best|Plum Organics|Sprout|Cerebelly|Little Spoon|Once Upon a Farm|Yumi|Peter Rabbit Organics|Serenity Kids|Great Value|Parent's Choice|Member's Mark~babyFood
-~Gerber|Beech-Nut|Happy Baby|Earth's Best|Plum Organics|Sprout|Cerebelly|Once Upon a Farm|Serenity Kids|Little Bellies|Amara|Great Value|Parent's Choice|Member's Mark~babyFood
-~Gerber|Beech-Nut|Happy Baby|Earth's Best|Plum Organics|Great Value|Parent's Choice|Member's Mark~babyFood
-~Johnson's|Aveeno Baby|Cetaphil Baby|Babyganics|Mustela|CeraVe Baby|Eucerin Baby|Aquaphor|Desitin|Boudreaux's Butt Paste|A+D|Triple Paste|Burt's Bees Baby|The Honest Company|Hello Bello|Weleda|Attitude|Babo Botanicals|California Baby|Mommy's Bliss|Little Remedies|Zarbee's|Hyland's|Boiron|FridaBaby|Philips Avent|Dr. Brown's|Medela|Lansinoh|MAM|Tommee Tippee|Comotomo|Evenflo|Nuk|Playtex|Boon|Munchkin|Nuby|Sassy|The First Years|Skip Hop|Boppy|Halo|Aden + Anais|SwaddleMe|Love to Dream|Nested Bean|KeaBabies|Copper Pearl~babyCare
`),
  "Pet Care": D(`
Dry Dog Food~Purina|Pedigree|Blue Buffalo|Iams|Nutro|Natural Balance|Wellness|Hill's Science Diet|Royal Canin|Taste of the Wild|Rachael Ray Nutrish|Purina ONE|Purina Pro Plan|Kibbles 'n Bits|Nature's Recipe|NutriSource|Diamond|4health|Great Value|Kirkland Signature|Member's Mark|Ol' Roy|Beneful|Merrick|Canidae|Fromm|Orijen|Acana|Victor|Eagle Pack|Solid Gold|Halo~dryPetFood
Dry Cat Food~Purina|Meow Mix|Friskies|Iams|Blue Buffalo|Purina ONE|Purina Cat Chow|Purina Pro Plan|Rachael Ray Nutrish|Hill's Science Diet|Royal Canin|Nutro|Natural Balance|Wellness|Taste of the Wild|9Lives|Kit & Kaboodle|Great Value|Kirkland Signature|Member's Mark|Special Kitty~dryPetFood
Wet Dog Food~Pedigree|Cesar|Purina|Alpo|Beneful|Gravy Train|Rachael Ray Nutrish|Hill's Science Diet|Blue Buffalo|Iams|Royal Canin|Freshpet|Great Value|Kirkland Signature|Member's Mark|Ol' Roy~wetPetFood
Wet Cat Food~Fancy Feast|Friskies|Purina|Meow Mix|Sheba|9Lives|Iams|Blue Buffalo|Wellness|Hill's Science Diet|Royal Canin|Nutro|Natural Balance|Weruva|Tiki Pets|Great Value|Kirkland Signature|Member's Mark|Special Kitty~wetPetFood
-~Milk-Bone|Purina|Pedigree|Pup-Peroni|Snausages|Beggin' Strips|Busy Bone|Greenies|Dentastix|Zuke's|Blue Buffalo|Nylabone|Benebone|DreamBone|Great Value|Kirkland Signature|Member's Mark|Ol' Roy~petTreats
-~Temptations|Greenies|Purina|Friskies|Fancy Feast|Sheba|Wellness|Vital Essentials|PureBites|Hartz|Meow Mix|Great Value|Kirkland Signature|Member's Mark|Special Kitty|Inaba|Churu|Delectables|Tiki Pets~petTreats
-~Fresh Step|Tidy Cats|Arm & Hammer|Dr. Elsey's|Great Value|Kirkland Signature|Member's Mark|Special Kitty|PrettyLitter|World's Best Cat Litter|Feline Pine|Naturally Fresh|Ökocat|Exquisicat|Catit|Petmate|Van Ness|IRIS|Richell~catLitter
-~PetSafe|Petmate|Kong|Nylabone|Chuckit!|Outward Hound|Petstages|West Paw|Planet Dog|Jolly Pets|Benebone|Furhaven|K&H Pet Products|PetFusion|Best Friends by Sheri|Bedsure|MidWest|Catit|Van Ness|IRIS|Nature's Miracle|Simple Solution|Angry Orange|Rocco & Roxie|FURminator|Andis|Wahl|Oster|Safari|ThunderShirt|Adaptil|Feliway|Zesty Paws|Nutramax|Cosequin|VetriScience|NexGard|Frontline|Seresto|Advantage|Bravecto|Simparica|Revolution|Capstar|TropiClean|Earthbath|Vet's Best|Skout's Honor|Great Value|Kirkland Signature|Member's Mark~petCare
`),
  "Home & Bedding": D(`
Sheet Set~Great Value|Mainstays|Better Homes & Gardens|Elegant Comfort|Bedsure|Utopia Bedding|Nestl|CGK Unlimited|Mellanni|Sweet Home Collection|Beckham Luxury Linens|Amazon Basics|Micro Flannel|Lux Decor|Comfort Spaces|Madison Park~sheetSet
-~Bedsure|Great Value|Mainstays|Better Homes & Gardens|Utopia Bedding|Mellanni|Elegant Comfort|Comfort Spaces|Madison Park|Amazon Basics|Sleep Philosophy|Beckham Luxury Linens|Sweet Home Collection|The Company Store|Serta|Sealy|Beautyrest|Cannon|Croscill|downluxe|CozyLux~comforter
-~Serta|Sealy|Beautyrest|Tempur-Pedic|Great Value|Mainstays|Beckham Luxury Linens|Coop Home Goods|Purple|Casper|Tuft & Needle|Snuggle-Pedic|Sleep Innovations|Malouf|Linenspa|Pacific Coast|Downlite|Utopia Bedding|Mellanni|Bedsure|Amazon Basics~pillow
-~Great Value|Mainstays|Better Homes & Gardens|Utopia Towels|Amazon Basics|Cannon|Royal Velvet|Martex|Charisma|Croscill|Kassatex|COTTON CRAFT|DAPU|Lane Linen|American Soft Linen~towel
-~Great Value|Mainstays|Better Homes & Gardens|NICETOWN|Deconovo|H.VERSAILTEX|MIULEE|BGment|PONY DANCE|Warm Home Designs|No. 918|Eclipse|Sun Zero|Madison Park|Elrene Home Fashions~curtain
-~Serta|Sealy|Beautyrest|Great Value|Mainstays|Better Homes & Gardens|ExceptionalSheets|SafeRest|Linenspa|Zinus|Tempur-Pedic|Malouf|ViscoSoft|Sleep Innovations|Sleep Philosophy|Utopia Bedding|Mellanni|Bedsure|Amazon Basics|BioPEDIC|AllerEase|Therapedic~mattressPad
-~ClosetMaid|Rubbermaid|Sterilite|IRIS USA|Made Smart|mDesign|Simple Houseware|Songmics|The Container Store|Keter|Brightroom~storage
Laundry Detergent~Tide|Gain|All|Arm & Hammer|Persil|Seventh Generation|Dreft|Great Value~laundryDetergent
Fabric Softener~Downy|Snuggle|Gain|Great Value|Bounce|Seventh Generation~fabricCare
-~Better Homes & Gardens|Mainstays|Ashley Furniture|Signature Design by Ashley|Walker Edison|Sauder|Dorel Living|Ameriwood Home|South Shore|Novogratz|CosmoLiving by Cosmopolitan~officeFurniture
-~Yankee Candle|Bath & Body Works|WoodWick|Capri Blue|Paddywax|Voluspa|Nest|Thymes|Illume|Goose Creek Candle|Febreze|Glade~airFresh
`),
  "Kitchen & Dining": D(`
-~T-fal|Calphalon|Cuisinart|Great Value|Mainstays|Tramontina|Lodge|Le Creuset|All-Clad|Rachael Ray|Farberware|Circulon|Anolon|GreenLife|GreenPan|Granitestone|HexClad|Made In|Our Place|Caraway|Gotham Steel|Blue Diamond|Viking|Ballarini|Zwilling~cookware
-~Corelle|Great Value|Mainstays|Better Homes & Gardens|Gibson Home|Mikasa|Lenox|Noritake|Pfaltzgraff|Oneida|Kate Spade New York|Wedgwood|Royal Doulton|Villeroy & Boch|Dansk|Fiestaware|Homer Laughlin|Portmeirion|Spode|Johnson Brothers|Vancasso|AmorArc|Famiware|Mora|Sweese|LE TAUCI|Stone Lain|10 Strawberry Street|Certified International~dinnerware
-~Libbey|Great Value|Mainstays|Better Homes & Gardens|Luminarc|Arcoroc|Anchor Hocking|Pyrex|Duralex|Bormioli Rocco|Luigi Bormioli|Waterford|Mikasa|Spiegelau|Riedel|Schott Zwiesel|Nachtmann|Krosno|Godinger|Circleware|Dragon Glassware|Venero|Simple Modern|Tervis|YETI|Stanley|Hydro Flask|Contigo|CamelBak|Nalgene|Klean Kanteen|Owala|S'well|Corkcicle|Zak Designs|Thermos~drinkware
-~Oneida|Great Value|Mainstays|Better Homes & Gardens|Gibson Home|Hampton Silversmiths|Mikasa|International Silver|Wallace|Towle|Gorham|Reed & Barton|J.A. Henckels International|Zwilling|WMF|Cuisinart|KitchenAid|Knork|Mepra|Cambridge Silversmiths|Liberty Tabletop|Fortessa|Michael Aram|Kate Spade New York~flatware
-~Pyrex|Glasslock|Rubbermaid|Sterilite|Great Value|Mainstays|Better Homes & Gardens|Snapware|Anchor Hocking|OXO|Cambro|Simplehouseware|Utopia Kitchen|Bayco|Vtopmart|KooK|Komax|Ello|Good Cook~kitchenStorage
-~Ninja|Cuisinart|Great Value|Mainstays|Keurig|Hamilton Beach|BLACK+DECKER|Breville|KitchenAid|Instant|Oster|Nostalgia|Elite Gourmet|COSORI|Nuwave|Farberware|Magic Bullet|NutriBullet|Vitamix|Blendtec|Smeg|Dash|Mueller|Cuckoo|Tiger|Zojirushi|Aroma|Panasonic|Toshiba|Galanz|Magic Chef|Danby~smallAppliance
-~Wilton|Great Value|Mainstays|Better Homes & Gardens|USA Pan|Nordic Ware|Chicago Metallic|Fat Daddio's|Rachael Ray|Pampered Chef|OXO|Farberware|Silpat|Amazon Basics|NutriChef|TeamFar|Cuisinart|Anolon|KITESSENSU~bakeware
-~Zwilling J.A. Henckels|J.A. Henckels International|Wüsthof|Victorinox|Shun|Global|Miyabi|Dalstrong|Mercer Culinary|Chicago Cutlery|Cuisinart|KitchenAid|Farberware|Ginsu|Kyoku|imarku|OXO|Rada Cutlery|Cutco|Great Value|Mainstays~cutlery
-~OXO|Great Value|Mainstays|Better Homes & Gardens|KitchenAid|Cuisinart|Zyliss|Kuhn Rikon|Good Cook|Cuisipro|Microplane|Farberware|Rachael Ray|GIR|Utopia Kitchen|StarPack Home|Tovolo|Fox Run Brands|Norpro|Mrs. Anderson's Baking|Winco|Rubbermaid|Progressive International|Prep Solutions|Chef'n|Dreamfarm|Joseph Joseph|Cole & Mason~gadgets
`),
  "Home Office": D(`
-~Paper Mate|Pilot|BIC|Pentel|Sharpie|EXPO|Crayola|Staples|Great Value|uni-ball|Zebra Pen|Fisher Space Pen|Cross|Parker|Waterman|Lamy~pen
-~HP|Hammermill|Great Value|Staples|Georgia-Pacific|Astrobrights|Neenah|Boise X-9|Weyerhaeuser|Navigator|International Paper|Copy Plus|Amazon Basics~paper
-~Oxford|Mead|Five Star|Top Flight|Great Value|Mainstays|Moleskine|Leuchtturm1917|Rocketbook|Rhodia|Field Notes|Paperage|C.R. Gibson|Paperblanks|Black n' Red|Yoobi~notebook
-~Swingline|3M|Scotch|Gorilla|Duck|Post-it|Staples|Fellowes|Avery|Wilson Jones|Smead|Pendaflex|Great Value|Mainstays|Bostitch|Officemate|ACCO|Universal|Business Source~officeSupplies
-~Bush Furniture|Sauder|Mainstays|Better Homes & Gardens|Walker Edison|Ashley Furniture|Ameriwood Home|Altra Furniture|Dorel Living|South Shore|Monarch Specialties|WE Furniture|Whalen Furniture|Tvilum|Furinno|Ikea|Serta|Herman Miller|Steelcase|Haworth|HON|Branch Furniture|Autonomous|Secretlab|Anda Seat|DXRacer|Respawn|OFM~officeFurniture
-~SwissGear|JanSport|The North Face|Nike|Adidas|Under Armour|Herschel|Fjällräven|Patagonia|Osprey|Gregory|Deuter|High Sierra|Samsonite|Travelon|Pacsafe|eBags|Timbuk2|Chrome Industries|Great Value|Mainstays|Wonder Nation|No Boundaries|Gap|Old Navy|Hollister|American Eagle|Aeropostale|Justice|Steve Madden|Calvin Klein|Tommy Hilfiger|Nautica|Michael Kors~backpack
`),
  "Electronics": D(`
-~Samsung|LG|Sony|TCL|Hisense|Vizio|onn.|Insignia|Sharp|Toshiba|Philips|Westinghouse|Roku|Amazon|Google|Skyworth|Element|JVC|Sansui~tv
-~Sony|Bose|Apple|JBL|Beats|Skullcandy|Anker|JLab|Audio-Technica|Sennheiser|Samsung|Monster|iJoy|Belkin|TOZO|Raycon|Microsoft|Razer|Turtle Beach|HyperX|SteelSeries|Logitech|Corsair|onn.~headphones
-~Sony|Bose|JBL|Ultimate Ears|Anker|Soundcore|OontZ|Cambridge SoundWorks|TREBLAB|DOSS|Sonos|Marshall|Harman Kardon|Polk Audio|Klipsch|Vizio|Samsung|LG|Amazon Echo|Google Nest|Apple|onn.~speaker
-~Anker|Belkin|Apple|Samsung|Spigen|UGREEN|Amazon Basics|onn.|Native Union|Baseus|AUKEY|RAVPower|INIU|Duracell|Energizer|Miady|Ventev|Monster~charger
-~Duracell|Energizer|Amazon Basics|onn.|Eveready|Rayovac|ACDelco|Panasonic|Sony|Kirkland Signature|Member's Mark|EBL|Powerowl|HiQuick~battery
-~HP|Dell|Lenovo|Apple|ASUS|Acer|Microsoft|Samsung|Google|LG|Sony|TCL|Hisense|Roku|Amazon|onn.|Insignia|Vizio|Logitech|Wyze|Ring|TP-Link|Netgear|SanDisk|Seagate|Western Digital|Kingston|Garmin|GoPro|DJI|Canon|Nikon|Kodak|Polaroid|Fujifilm|VTech|LeapFrog|Nintendo|Ematic|Sylvania|Naxa~device
`),
  "Toys & Games": D(`
-~Mattel|Hasbro|LEGO|Fisher-Price|Hot Wheels|Barbie|NERF|Playmobil|Melissa & Doug|VTech|LeapFrog|Spin Master|Jakks Pacific|MGA Entertainment|L.O.L. Surprise!|Funko|Jazwares|Moose Toys|Zuru|Basic Fun!|Just Play|Tomy|Ravensburger|University Games|Goliath|Pressman|Winning Moves|Gamewright|Blue Orange|Asmodee|Disney|Marvel|Star Wars|Nintendo|Pokémon|Minecraft|Bandai|Schleich|Safari Ltd.|Papo|Terra by Battat|KidKraft|Step2|Little Tikes|Radio Flyer|Power Wheels|Peg Perego|Costway|Best Choice Products|Hedstrom|PlasmaCar|Micro Kickboard|Razor|Dynacraft~toy
`),
  "Sports & Outdoors": D(`
-~Wilson|Spalding|Rawlings|Franklin Sports|Baden|Nike|Adidas|Under Armour|Champion|Molten|Tachikara|Mikasa|Penn|Dunlop|Head|Babolat|Yonex|Callaway|TaylorMade|Titleist|Ping|Easton|DeMarini|Louisville Slugger|Marucci|STX|Brine|Warrior|Maverik|Shock Doctor|McDavid|SKLZ|PodiuMax|GoSports~sportGear
-~Gaiam|Manduka|Jade Yoga|Liforme|Alo|Lululemon|TRX|Bowflex|NordicTrack|ProForm|Peloton|Schwinn|Sunny Health & Fitness|Horizon Fitness|XTERRA Fitness|Marcy|Body Solid|Echelon|Therabody|Hyperice|TriggerPoint|Amazon Basics|ProsourceFit|Yes4All|RitFit|SereneLife|Goplus|Best Choice Products|Costway~fitness
-~Coleman|Ozark Trail|REI Co-op|Patagonia|The North Face|Marmot|Kelty|Big Agnes|MSR|Nemo|Sea to Summit|Therm-a-Rest|Osprey|Gregory|Deuter|YETI|RTIC|Igloo|Eureka!|ALPS Mountaineering|TETON Sports|Wenzel|CORE Equipment|Black Diamond|Petzl|Garmin|Suunto|Gerber|Leatherman|SOG|Buck Knives|Victorinox|Kershaw|CRKT|Stanley|Hydro Flask|Nalgene|CamelBak|LifeStraw|Sawyer|Jetboil|Camp Chef|GSI Outdoors|ENO|Kammok|Wise Owl Outfitters~camp
-~Schwinn|Mongoose|Huffy|Kent|Dynacraft|Trek|Specialized|Giant|Cannondale|Canyon|Bianchi|Raleigh|Electra|REI Co-op|Sixthreezero|Hyper|Kulana|Pacific Cycle|Strider|Razor|Micro Kickboard|Segway|Gotrax|Hover-1|Swagtron|Jetson|Tony Hawk|Bell|Giro~bike
`),

  "Auto Care": D(`
Motor Oil~Mobil 1|Castrol|Valvoline|Pennzoil|Quaker State|Shell Rotella|Royal Purple|Amsoil|Liqui Moly|Kendall|Phillips 66|Super Tech|STP|Lucas Oil|Red Line|Motul|Idemitsu|Eneos|Havoline|Chevron~motorOil
Oil Filter~Fram|K&N|Mobil 1|Bosch|ACDelco|Purolator|WIX|Mahle|MicroGard|Super Tech|Motorcraft|Toyota|Honda|Denso|Hengst|Mann-Filter|Fleetguard|Donaldson|NAPA|CarQuest~oilFilter
Wiper Blades~Rain-X|Bosch|Michelin|ANCO|Trico|Valeo|PIAA|SilBlade|Goodyear|AERO|Duralast|Super Tech~wiperBlades
-~Sylvania|Philips|GE|PIAA|Bosch|Hella|Osram|Wagner|Eiko|Putco|Auxito|Fahren|Alla Lighting|SEALIGHT|HIKARI|Super Tech~headlightBulbs
-~Meguiar's|Turtle Wax|Chemical Guys|Mothers|Griot's Garage|Adam's Polishes|Armor All|Collinite|CarGuys|Shine Armor|TriNova|Zymöl|Duragloss|Formula 1|Nu Finish|Black Magic|Super Tech~carCare
-~NOCO|Schumacher|STANLEY|Clore Automotive|Jump-N-Carry|BLACK+DECKER|DEWALT|EverStart|GOOLOO|Beatit|DBPOWER|TOPDON|Buture|AVAPOW|NEXPOW|Hulkman~jumpStarter
`),
  "Auto Accessories": D(`
-~WeatherTech|Husky Liners|3D MAXpider|3W|OEDRO|Motor Trend|BDK|FH Group|SMARTLINER|Lloyd Mats|Coverking|Intro-Tech Automotive|Aries|Westin|Amazon Basics~floorMats
-~Coverking|Covercraft|FH Group|BDK|Leader Accessories|Dickies|CalTrend|Smittybilt|Rough Country|PRP|Corbeau|Saddleman|FIA|Amazon Basics~seatCovers
-~iOttie|Scosche|RAM Mounts|Mpow|Lamicall|Andobil|TORRAS|ESR|Spigen|Syncwire|Ainope|Belkin|onn.|Great Value~phoneMounts
-~Thule|Yakima|Rhino-Rack|INNO|Kuat|RockyMounts|1UP USA|Vantech|AA-Racks|SportRack|Allen Sports|Swagman|Hollywood Racks|Saris|CURT|Reese|Draw-Tite~roofRacks
-~Thule|Yakima|Rhino-Rack|Kuat|RockyMounts|1UP USA|SportRack|Allen Sports|Swagman|Hollywood Racks|Saris|Kupper|Retrospec|WEIZE~bikeRacks
Steering Wheel Covers~BDK|FH Group|SEG Direct|CAR PASS|Valleycomfy|CZC AUTO|Mayco Bell|Amazon Basics~steeringWheelCovers
Trailer Balls~CURT|Reese|Draw-Tite|Hidden Hitch|Andersen|Trimax|Bulldog|Weigh Safe|Blue Ox|Fastway|Gen-Y~trailerBalls
Sun Shades~BDK|FH Group|Motor Trend|Amazon Basics|Kindmore|Magnelex|EzyKingu|A1~sunShades
`),
  "Tools & Hardware": D(`
-~DEWALT|CRAFTSMAN|Hart|HYPER TOUGH|BLACK+DECKER|Bosch|SKIL|Milwaukee|Metabo HPT|Flex|Makita|Worx|Kobalt|Porter-Cable|Ridgid|WEN~powerTool
-~CRAFTSMAN|DEWALT|Stanley|TEKTON|Channellock|Klein Tools|IRWIN|GEARWRENCH|HART|Milwaukee|Knipex|Wiha|Wera|Proto|Wright Tool|Snap-on|Matco|Cornwell|Mac Tools|SK Hand Tool|ATD|OEM Tools|Powerbuilt|Amazon Basics~handTool
-~Hillman|Fastenal|Simpson Strong-Tie|GRK|SPAX|DeckMate|Power Pro|NEIKO|Prime-Line|Midwest Fastener|Hard-to-Find Fastener|Bolt Dropper|Davco|SNUG|Glarks|Swpeet~fastener
-~Duck|3M|Gorilla|ShurTape|Intertape|Nashua|T-REX|Great Value|HYPER TOUGH~tape
-~Loctite|Gorilla|Krazy Glue|E6000|J-B Weld|Bob Smith Industries|MITREAPEX|Elmer's|Super Glue|Great Value|Scotch~adhesive
-~DEWALT|Milwaukee|CRAFTSMAN|Stanley|HART|Kobalt|Gladiator|Waterloo|Bosch|Knaack|Sterilite|Akro-Mils|Plano|Stack-On|HYPER TOUGH|Montezuma~storage
-~Werner|Little Giant|Louisville Ladder|Gorilla Ladders|HART|Cosco|DEWALT|Milwaukee|Xtend & Climb|Telesteps|Michigan Ladder|Ladder-Max~ladder
`),

  "Outdoor & Garden": D(`
-~Scotts|Miracle-Gro|Pennington|Sta-Green|Vigoro|Espoma|Jobe's|BioAdvanced|Lesco|The Andersons|GreenView|Safer Brand|FoxFarm|Dyna-Gro~lawnCare
-~Roundup|Ortho|Spectracide|Preen|Compare-N-Save|Gordon's|Southern Ag|Ferti-Lome|Hi-Yield|Natural Armor|Green Gobbler|Bonide~lawnCare
Garden Hose~Gilmour|Flexzilla|NeverKink|CRAFTSMAN|Dramm|Water Right|Teknor Apex|Zero-G|Swan~hose
Planter~Bloem|The HC Companies|Akro-Mils|Suncast|Classic Home and Garden|Step2|Verade|Keter|La Jolie Muse|Fox & Fern|Fopamtri|T4U~planter
Seeds~Burpee|Park Seed|Seed Needs|Sow Right Seeds|David's Garden Seeds|Johnny's Selected Seeds|Ferry-Morse|Lake Valley Seed|Survival Garden Seeds|Isla's Garden Seeds|Everwilde Farms~seeds
Lawn Mower~Honda|Husqvarna|Toro|Troy-Bilt|Greenworks|EGO|Snapper|CRAFTSMAN|Ryobi|BLACK+DECKER|Kubota|John Deere|Ariens|Cub Cadet|MTD|Yard Machines~mower
-~Better Homes & Gardens|Mainstays|Great Value|Allen + Roth|Style Selections|Cosco|Sundale Outdoor|Grand Patio|Homall|U-MAX|Nuu Garden|Domi Outdoor Living|YITAHOME|JOIVI|Patiorama|Wisteria Lane~patioSet
Bird Feeder~Perky-Pet|Droll Yankees|Duncraft|Aspects|Brome|Woodlink|Kaytee|Stokes Select|Erva|Backyard Essentials|Twinkle Star|Kingsyard~birdFeeder
String Lights~Brightown|Brightech|addlon|VMAN|Minet|Decute|MZD|HUI|Xinglight|Hambort~stringLights
`),
  "Boys": D(`
Boys' T-Shirts~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Hanes|Fruit of the Loom|Garanimals|Nike|Adidas|Under Armour|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Okie Dokie|Arizona~tee
Boys' Jeans~Levi's|Wrangler|Lee|The Children's Place|OshKosh B'gosh|Wonder Nation|Garanimals|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Arizona|Hollister~bottoms
Boys' Shorts~The Children's Place|Carter's|Wonder Nation|Nike|Adidas|Under Armour|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Arizona|Hanes~bottoms
Boys' Hoodies & Sweatshirts~Nike|Adidas|Under Armour|Champion|The Children's Place|Wonder Nation|Hanes|Gap Kids|Old Navy|Cat & Jack|Hollister|Abercrombie Kids~tops
Boys' Jackets & Coats~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Nike|Adidas|Under Armour|Columbia|The North Face|Gap Kids|Old Navy|Cat & Jack|London Fog|iXtreme|Urban Republic~tops
Boys' Underwear~Hanes|Fruit of the Loom|The Children's Place|Wonder Nation|Garanimals|Under Armour|Gap Kids|Old Navy|Cat & Jack~underwear
Boys' Socks~Hanes|Fruit of the Loom|Nike|Adidas|Under Armour|The Children's Place|Wonder Nation|Jefferies Socks|Gap Kids|Old Navy|Cat & Jack~socks
Boys' Pajamas~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Hanes|Gap Kids|Old Navy|Cat & Jack|Harry Potter|Minecraft|Pokémon|Star Wars|Marvel~pajamas
Boys' Swimwear~Speedo|Nike|Adidas|Under Armour|The Children's Place|Wonder Nation|Gap Kids|Old Navy|Cat & Jack|Kanu Surf|i play.|Fruit of the Loom~swimwear
Boys' Polos~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Nike|Adidas|Under Armour|Gap Kids|Old Navy|Cat & Jack|U.S. Polo Assn.|Nautica|IZOD|French Toast~polo
Boys' Button-Down Shirts~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Gap Kids|Old Navy|Cat & Jack|U.S. Polo Assn.|Nautica|IZOD|French Toast|Arrow~buttonDown
`),
  "Girls": D(`
Girls' T-Shirts~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Garanimals|Hanes|Nike|Adidas|Under Armour|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Justice|Arizona~tee
Girls' Jeans~Levi's|The Children's Place|Carter's|Wonder Nation|Garanimals|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Justice|Arizona|Hollister~bottoms
Girls' Shorts~The Children's Place|Carter's|Wonder Nation|Nike|Adidas|Gap Kids|Old Navy|Cat & Jack|Jumping Beans|Justice|Arizona~bottoms
Girls' Leggings~The Children's Place|Carter's|Wonder Nation|Nike|Adidas|Under Armour|Gap Kids|Old Navy|Cat & Jack|Justice|Hanes|Lands' End~bottoms
Girls' Dresses~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Gap Kids|Old Navy|Cat & Jack|Justice|Hanna Andersson|Tea Collection|Lands' End|Gymboree~dress
Girls' Hoodies & Sweatshirts~Nike|Adidas|Under Armour|Champion|The Children's Place|Wonder Nation|Justice|Gap Kids|Old Navy|Cat & Jack|Hollister|Abercrombie Kids~tops
Girls' Jackets & Coats~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Nike|Adidas|Columbia|The North Face|Gap Kids|Old Navy|Cat & Jack|Hanna Andersson|London Fog~tops
Girls' Underwear~Hanes|Fruit of the Loom|The Children's Place|Carter's|Wonder Nation|Garanimals|Justice|Gap Kids|Old Navy|Cat & Jack~underwear
Girls' Socks~Hanes|Fruit of the Loom|Nike|Adidas|The Children's Place|Wonder Nation|Jefferies Socks|Gap Kids|Old Navy|Cat & Jack|Justice~socks
Girls' Pajamas~The Children's Place|Carter's|OshKosh B'gosh|Wonder Nation|Hanes|Gap Kids|Old Navy|Cat & Jack|Justice|Disney|Harry Potter~pajamas
Girls' Swimwear~Speedo|Nike|Adidas|The Children's Place|Wonder Nation|Gap Kids|Old Navy|Cat & Jack|Kanu Surf|i play.|Carter's~swimwear
`),
  "Shoes": D(`
-~Nike|Adidas|Jordan|New Balance|Converse|Vans|Skechers|Puma|Reebok|ASICS|Brooks|Saucony|Hoka|On|Salomon|Merrell|Keen|Teva|Timberland|Dr. Martens|Clarks|ECCO|Birkenstock|Crocs|Hey Dude|Toms|Sperry|UGG|Bearpaw|Steve Madden|Nine West|Sam Edelman|Naturalizer|Vionic|Dr. Scholl's|Keds|K-Swiss|Fila|Under Armour|Champion|DREAM PAIRS|Athletic Works|Avia|George|Wonder Nation|Time and Tru|No Boundaries~shoe
`),
  "Mens": D(`
Men's T-Shirts~Hanes|Fruit of the Loom|Gildan|Comfort Colors|Champion|Russell Athletic|Nike|Adidas|Under Armour|The North Face|Columbia|Carhartt|Dickies|Levi's|George|Free Assembly|Athletic Works|Avia|And1~tee
Men's Jeans~Levi's|Wrangler|Lee|Lucky Brand|American Eagle|Old Navy|Gap|George|Bonobos~bottoms
Men's Pants~Dickies|Carhartt|Lee|Wrangler|Columbia|Haggar|Dockers|Under Armour|The North Face|George|Free Assembly~bottoms
Men's Shorts~Nike|Adidas|Under Armour|Champion|Columbia|The North Face|Lee|Wrangler|Old Navy|Gap|American Eagle|George|Athletic Works~bottoms
Men's Hoodies & Sweatshirts~Hanes|Champion|Russell Athletic|Nike|Adidas|Under Armour|The North Face|Columbia|Carhartt|Dickies|Old Navy|Gap|George|Free Assembly~tops
Men's Jackets & Coats~The North Face|Columbia|Carhartt|Dickies|Wrangler|Timberland|Wolverine|Ariat|Harley-Davidson|George|Free Assembly~tops
Men's Sweaters~Hanes|Amazon Essentials|Goodthreads|George|Polo Ralph Lauren|Nautica|Izod|Tommy Hilfiger|Calvin Klein|Hugo Boss|Lucky Brand|Levi's~tops
Men's Polos~Nike|Adidas|Under Armour|Polo Ralph Lauren|Nautica|Izod|Lacoste|Tommy Hilfiger|Calvin Klein|U.S. Polo Assn.|Haggar|George|Amazon Essentials|Goodthreads~polo
Men's Button-Down Shirts~Polo Ralph Lauren|Nautica|Izod|Tommy Hilfiger|Calvin Klein|Hugo Boss|Arrow|Wrangler|Lee|Carhartt|George|Amazon Essentials|Goodthreads|U.S. Polo Assn.~buttonDown
Men's Underwear~Hanes|Fruit of the Loom|Jockey|Under Armour|Nike|Adidas|Calvin Klein|Tommy Hilfiger|George|Amazon Essentials|Goodthreads~underwear
Men's Socks~Hanes|Fruit of the Loom|Nike|Adidas|Under Armour|Champion|Dickies|Carhartt|Gold Toe|Jefferies Socks|George|Amazon Essentials~socks
Men's Pajamas~Hanes|Fruit of the Loom|Jockey|Under Armour|Nike|Adidas|Calvin Klein|Nautica|George|Amazon Essentials|Goodthreads~pajamas
Men's Swimwear~Speedo|Nike|Adidas|Under Armour|TYR|Champion|Nautica|Tommy Hilfiger|Calvin Klein|Gap|Old Navy|George~swimwear
`),
  "Ladies": D(`
Women's T-Shirts~Hanes|Nike|Adidas|Under Armour|Lululemon|Athleta|Old Navy|Gap|H&M|Zara|Uniqlo|Amazon Essentials|Time and Tru|Terra & Sky|No Boundaries|George|Avia|Athletic Works~tee
Women's Jeans~Levi's|Lee|Wrangler|Lucky Brand|Old Navy|Gap|H&M|Zara|Uniqlo|American Eagle|Torrid|Lane Bryant|Time and Tru|Terra & Sky|No Boundaries|George~bottoms
Women's Leggings~Lululemon|Athleta|Fabletics|Vuori|Alo Yoga|Beyond Yoga|Nike|Adidas|Under Armour|Old Navy|Spanx|90 Degree By Reflex|Colorfulkoala|Aerie|Amazon Essentials|Athletic Works|Avia~bottoms
Women's Dresses~Old Navy|Gap|H&M|Zara|Uniqlo|Forever 21|American Eagle|Torrid|Lane Bryant|Chico's|Ann Taylor|Loft|J.Crew|Madewell|Reformation|Free People|Anthropologie|Lulus|Amazon Essentials|Time and Tru|Terra & Sky|George~dress
Women's Hoodies & Sweatshirts~Hanes|Nike|Adidas|Under Armour|Lululemon|Athleta|Champion|Old Navy|Gap|H&M|Zara|Uniqlo|Forever 21|Amazon Essentials|Time and Tru|Terra & Sky|No Boundaries|George~tops
Women's Jackets & Coats~Levi's|The North Face|Columbia|Old Navy|Gap|H&M|Zara|Uniqlo|Forever 21|Amazon Essentials|Time and Tru|Terra & Sky|George~tops
Women's Sweaters~Hanes|Amazon Essentials|Goodthreads|Old Navy|Gap|H&M|Zara|Uniqlo|Time and Tru|Terra & Sky|George|J.Crew~tops
Women's Polos~Nike|Adidas|Under Armour|Lacoste|Ralph Lauren|Nautica|Izod|Tommy Hilfiger|Calvin Klein|Old Navy|Gap|Amazon Essentials~polo
Women's Button-Down Shirts~Ralph Lauren|Nautica|Izod|Tommy Hilfiger|Calvin Klein|Old Navy|Gap|H&M|Zara|Uniqlo|Amazon Essentials|Goodthreads|Time and Tru|Terra & Sky~buttonDown
Women's Underwear~Hanes|Jockey|Maidenform|Warner's|Bali|Victoria's Secret|PINK|Aerie|Fruit of the Loom|Time and Tru|Terra & Sky|No Boundaries|George~underwear
Women's Socks~Hanes|Fruit of the Loom|Nike|Adidas|Under Armour|Lululemon|Smartwool|Time and Tru|No Boundaries|George~socks
Women's Pajamas~Hanes|Fruit of the Loom|Jockey|Under Armour|Nike|Adidas|Lululemon|Old Navy|Gap|Victoria's Secret|PINK|Aerie|Time and Tru|Terra & Sky|George~pajamas
Women's Swimwear~Speedo|Nike|Adidas|Under Armour|TYR|Athleta|Lululemon|Old Navy|Gap|Aerie|Victoria's Secret|Time and Tru|Terra & Sky|George~swimwear
`),
  "Books & Media": D(`
-~Penguin Random House|HarperCollins|Simon & Schuster|Macmillan|Hachette|Scholastic|Workman|Sourcebooks|Harlequin|Tor|Del Rey|William Morrow|Dutton|Knopf|Scribner|St. Martin's Press|Warner Bros.|Universal|Disney|Lionsgate|Paramount|Sony Pictures|20th Century Studios|MGM|Criterion|Shout! Factory|Kino Lorber|Viz Media|Yen Press|Seven Seas|Dark Horse|Image Comics|Marvel|DC|IDW|Boom! Studios|Oni Press|Dynamite|Titan Comics~book
`),
  "Arts & Crafts": D(`
-~Crayola|RoseArt|Prang|Sargent Art|Faber-Castell|Staedtler|Prismacolor|Derwent|Arteza|Ohuhu|Shuttle Art|Castle Art Supplies|Sakura|Tombow|Pilot|Posca|Montana|Molotow|Liquitex|Winsor & Newton|Golden|Canson|Strathmore|Bee Paper|Blick|Elmer's|Aleene's|Mod Podge|Plaid|X-Acto|Fiskars|Westcott|Perler|Hama|Melissa & Doug|Klutz|Craft-tastic|KiwiCo|Creativity for Kids|Lakeshore|Teacher Created Resources|Carson Dellosa|Hygloss|Pacon|Roylco~craft
`),
  "Celebrate": D(`
-~Unique|Amscan|Party City|Big Dot of Happiness|Creative Converting|Hoffmaster|Beistle|Anagram|Qualatex|CTI|Sempertex|Prextex|JOYIN|KatchOn|Juvale|Bright Creations|Hallmark|American Greetings|Papyrus|Recycled Paper Greetings|Designer Greetings|Gibson|Mead~party
`),
  "Seasonal": D(`
-~Holiday Time|GE|Home Accents Holiday|Holiday Living|National Tree Company|Balsam Hill|Vickerman|Puleo International|Fraser Hill Farm|Best Choice Products|Costway|Goplus|SereneLife|Home Heritage|The Holiday Aisle|Glitzhome|Evergreen|DII|Vailge~holiday
`),
};
