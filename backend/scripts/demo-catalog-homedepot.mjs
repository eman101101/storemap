/**
 * The Home Depot example's shelves, by department — one row per product:
 *
 *     product ~ brands that really make it ~ kind of product [~ min|max price]
 *
 * demo-catalog-kit.mjs explains the row.
 */
import "./demo-catalog-kinds-hardware.mjs";
import "./demo-catalog-kinds-general.mjs";
import { D } from "./demo-catalog-kit.mjs";

export default {
  "Power Tools": D(`
-~DEWALT|Milwaukee|Makita|Ryobi|RIDGID|Bosch|Metabo HPT|FLEX|CRAFTSMAN|BLACK+DECKER|SKIL|WEN|Dremel|Festool|SawStop|JET~powerTool
-~DEWALT|Milwaukee|Makita|Ryobi|RIDGID|Bosch|Metabo HPT|FLEX|CRAFTSMAN|BLACK+DECKER|SKIL~powerTool
`),
  "Hand Tools": D(`
-~Husky|DEWALT|CRAFTSMAN|Stanley|Milwaukee|Klein Tools|Channellock|TEKTON|GEARWRENCH|Wera|Wiha|Knipex|Estwing|Vaughan|Fiskars|Snap-on~handTool
-~Stanley FatMax|Milwaukee|DEWALT|Komelon|Tajima|FastCap|Keson|Lufkin|Husky|CRAFTSMAN~handTool
`),
  "Paint": D(`
-~BEHR|Glidden|PPG|KILZ|Rust-Oleum|Zinsser|Minwax|Varathane|Thompson's WaterSeal|Flood|Cabot|Sikkens~paint
`),
  "Lumber": D(`
-~Weyerhaeuser|Georgia-Pacific|Roseburg|Arauco|Boise Cascade|West Fraser|Canfor|Sierra Pacific|WeatherShield|Severe Weather|MicroPro Sienna|ProWood|Culpeper|Outdoor Essentials|Veranda|UFP~lumber
`),
  "Plumbing": D(`
-~Delta|Moen|Kohler|American Standard|Gerber|Price Pfister|Glacier Bay|HDX|Homewerks|Fluidmaster|Korky|Oatey|Charlotte Pipe|SharkBite|BrassCraft|Danco|Keeney|Toto|Niagara Conservation|Waterpik|Hansgrohe|Grohe|Symmons|Speakman|Watts|Everbilt~plumbing
`),
  "Electrical": D(`
-~Leviton|Legrand|Pass & Seymour|Lutron|Hubbell|Eaton|Siemens|Square D|Schneider Electric|GE|Southwire|Ideal|3M|Scotch|HDX|Commercial Electric~electrical
`),
  "Lighting": D(`
-~Philips|GE|Cree|Sylvania|EcoSmart|Halo|Commercial Electric|HDX|Hampton Bay|Home Decorators Collection|Hunter|Casablanca|Fanimation|Kichler|Progress Lighting|Quoizel|Hinkley|Minka Aire|Minka Lavery|Craftmade|Globe Electric|Sunco Lighting|Lithonia Lighting|Acuity Brands|Feit Electric~lighting
`),
  "Appliances": D(`
-~LG|Samsung|GE|Whirlpool|Maytag|KitchenAid|Bosch|Frigidaire|Electrolux|JennAir|Miele|Thermador|Gaggenau|Wolf|Sub-Zero|Dacor|Signature Kitchen Suite|Hisense|Toshiba|GE Profile|Café|Monogram~appliance
`),
  "Hardware": D(`
-~Schlage|Kwikset|Yale|Assa Abloy|Baldwin|Emtek|Weiser|Defiant|Brinks|Mul-T-Lock|Allegion|Sargent|Corbin Russwin|Hager|National Hardware|Everbilt|HDX|Liberty|Franklin Brass|Brainerd|Amerock|Top Knobs~doorHardware
-~Simpson Strong-Tie|GRK|SPAX|Hillman|Fastenal|DeckMate|Power Pro|NEIKO|Prime-Line|Midwest Fastener|Hard-to-Find Fastener|Bolt Dropper|Davco|SNUG|Glarks|Swpeet~fastener
`),
  "Storage & Organization": D(`
-~ClosetMaid|Rubbermaid|Sterilite|Husky|Gladiator|Keter|Suncast|Milwaukee|DEWALT|NewAge Products|Seville Classics|Triton Products|Durham Manufacturing|Borroughs|Hallowell|Pucel|Vestil|Global Industrial|Akro-Mils|Quantum Storage Systems~storage
`),
  "Lawn & Garden": D(`
-~Scotts|Miracle-Gro|Pennington|Vigoro|Espoma|Jobe's|BioAdvanced|Roundup|Ortho|Spectracide|Preen~lawnCare
Lawn Mower~Honda|Husqvarna|Toro|Troy-Bilt|EGO|Greenworks|Ryobi|BLACK+DECKER|CRAFTSMAN~mower
Garden Hose~Gilmour|Flexzilla|NeverKink|Dramm|Water Right|Teknor Apex|Zero-G|Swan~hose
`),
  "Grills & Outdoor": D(`
-~Weber|Char-Broil|Traeger|Big Green Egg|Kamado Joe|Pit Boss|Z Grills|Camp Chef|Green Mountain Grills|Rec Teq|Oklahoma Joe's|Napoleon|Broil King|Dyna-Glo|Char-Griller|Vision Grills|Yoder Smokers~grill
`),
  "Concrete": D(`
-~Quikrete|Sakrete|CTS Cement|Rapid Set|DAP|Sika|Custom Building Products|Mapei|Laticrete|Bostik|Henkel|Red Devil~cement
`),
  "Roofing": D(`
-~GAF|Owens Corning|CertainTeed|Atlas Roofing|IKO|TAMKO|Johns Manville|Malarkey|Decra|Berridge|Fabral|McElroy Metal|Petersen Aluminum~roofing
`),
  "Flooring": D(`
-~Shaw|Mohawk|Armstrong|Pergo|Lifeproof|Home Decorators Collection|TrafficMASTER|SmartCore|COREtec|CoreLuxe|Duralux|Somerset|Bruce|Hartco|Anderson Tuftex|Karastan~flooring
`),
  "Safety & Workwear": D(`
-~3M|Honeywell|MSA|Milwaukee|DEWALT|Klein Tools|Ergodyne|Radians|Pyramex|Jackson Safety|Kimberly-Clark|Ansell|Mechanix|Ironclad|Youngstown|Carhartt|Ariat|Caterpillar|Timberland PRO|Skechers Work|Reebok Work|KEEN Utility|Wolverine|Danner|Georgia Boot|Chippewa|Harley-Davidson|Dr. Martens|Bates~safety
`),
  "Doors & Windows": D(`
-~Jeld-Wen|Masonite|Therma-Tru|Andersen|Pella|Marvin|Milgard|Simonton|Atrium|Champion|MMI Door|Larson|Ply Gem|MI Windows|Soft-Lite~doorWindow
`),
  "Kitchens & Bath": D(`
-~Kohler|Delta|Moen|American Standard|Glacier Bay|Hampton Bay|Home Decorators Collection|Kraus|VIGO|Signature Hardware|Native Trails|Water Creation|Herbeau|Rohl|Perrin & Rowe|Shaws|Victoria + Albert|Cheviot|MTI Baths|Hydro Systems|Jacuzzi|Everbilt~plumbing
-~Glacier Bay|Hampton Bay|Home Decorators Collection|Kohler|Kraus|VIGO|Signature Hardware|Native Trails|Water Creation|Cutler Kitchen & Bath|Centec|Design House|Ronbow|Jeffrey Alexander|JSI Cabinetry|Hampton Bay Cabinets|Home Decorators Collection Cabinets|Thomasville Cabinetry~storage
`),
  "Seasonal": D(`
-~Home Accents Holiday|GE|National Tree Company|Balsam Hill|Vickerman|Puleo International|Fraser Hill Farm|Best Choice Products|Costway|Goplus|SereneLife|Glitzhome|Evergreen|DII~holiday
`),
};
