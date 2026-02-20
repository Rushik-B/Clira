import { 
  Mail, 
  Newspaper, 
  Bell, 
  CreditCard, 
  Plane, 
  FileText, 
  Eye, 
  Users, 
  MessageSquare, 
  Shield, 
  Home, 
  Briefcase, 
  ShoppingCart, 
  Heart, 
  Calendar, 
  Camera, 
  Music, 
  Car, 
  Utensils, 
  Dumbbell, 
  GraduationCap, 
  Building, 
  Laptop, 
  Smartphone, 
  Globe, 
  Package, 
  Truck, 
  Receipt, 
  PiggyBank, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Star, 
  Gift, 
  Zap, 
  Coffee, 
  Book, 
  Gamepad2, 
  Headphones, 
  Monitor,
  Settings,
  HelpCircle,
  Info,
  Sparkles,
  Target,
  Trophy,
  Bookmark,
  Flag,
  MapPin,
  Clock,
  Archive,
  Trash2,
  Filter,
  Search,
  Tag,
  Folder,
  FileImage,
  Video,
  Mic,
  Phone,
  MessageCircle,
  ThumbsUp,
  Share2,
  Download,
  Upload,
  Lock,
  Unlock,
  Key,
  Database,
  Server,
  Cloud,
  Wifi,
  Battery,
  Signal,
  Volume2,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Shuffle,
  Plus,
  Minus,
  X,
  Check,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

// Icon mapping based on keywords in folder names
const iconKeywordMap: Record<string, any> = {
  // Newsletter and Marketing
  'newsletter': Newspaper,
  'news': Newspaper,
  'marketing': Sparkles,
  'promotion': Star,
  'promo': Star,
  'deal': ShoppingCart,
  'offer': Gift,
  'sale': Tag,
  'discount': ShoppingCart,
  'subscribe': Bell,
  'digest': Book,

  // Notifications and Alerts
  'notification': Bell,
  'alert': AlertTriangle,
  'reminder': Clock,
  'update': ArrowUp,
  'announce': Zap,
  'confirm': CheckCircle,

  // Financial
  'financial': CreditCard,
  'finance': PiggyBank,
  'money': PiggyBank,
  'bank': Building,
  'payment': CreditCard,
  'billing': Receipt,
  'invoice': Receipt,
  'receipt': Receipt,
  'transaction': TrendingUp,
  'expense': Receipt,
  'budget': PiggyBank,
  'tax': FileText,
  'crypto': TrendingUp,
  'invest': TrendingUp,
  'stock': TrendingUp,

  // Travel
  'travel': Plane,
  'flight': Plane,
  'hotel': Building,
  'booking': Calendar,
  'trip': MapPin,
  'vacation': Camera,
  'airline': Plane,
  'ticket': Receipt,
  'reservation': Calendar,

  // Work and Business
  'work': Briefcase,
  'business': Building,
  'office': Laptop,
  'job': Briefcase,
  'career': Trophy,
  'project': Target,
  'meeting': Users,
  'conference': Users,
  'presentation': Monitor,
  'report': FileText,
  'document': FileText,
  'contract': FileText,
  'legal': Shield,

  // Social and Community
  'social': Users,
  'community': MessageSquare,
  'friend': Heart,
  'family': Home,
  'personal': Heart,
  'chat': MessageCircle,
  'message': Mail,
  'conversation': MessageSquare,
  'forum': Users,
  'group': Users,

  // Technology and Software
  'tech': Laptop,
  'software': Monitor,
  'app': Smartphone,
  'system': Settings,
  'security': Shield,
  'backup': Database,
  'cloud': Cloud,
  'server': Server,
  'api': Settings,
  'code': Monitor,
  'dev': Laptop,
  'development': Laptop,
  'github': Monitor,
  'git': Monitor,

  // Health and Fitness
  'health': Heart,
  'fitness': Dumbbell,
  'medical': Heart,
  'doctor': Heart,
  'hospital': Building,
  'pharmacy': Heart,
  'workout': Dumbbell,
  'exercise': Dumbbell,
  'gym': Dumbbell,

  // Education
  'education': GraduationCap,
  'school': GraduationCap,
  'university': Building,
  'course': Book,
  'learn': Book,
  'study': Book,
  'training': GraduationCap,

  // Entertainment
  'entertainment': Gamepad2,
  'game': Gamepad2,
  'music': Music,
  'movie': Video,
  'video': Video,
  'podcast': Headphones,
  'streaming': Play,
  'media': Video,

  // Shopping and E-commerce
  'shopping': ShoppingCart,
  'store': Building,
  'order': Package,
  'delivery': Truck,
  'shipping': Truck,
  'product': Package,
  'cart': ShoppingCart,
  'checkout': CreditCard,
  'purchase': ShoppingCart,

  // Food and Dining
  'food': Utensils,
  'restaurant': Utensils,
  'dining': Utensils,
  'recipe': Book,
  'cooking': Utensils,
  'takeout': Package,

  // Real Estate and Home
  'home': Home,
  'house': Home,
  'apartment': Building,
  'property': Home,
  'mortgage': Building,
  'rent': Home,
  'utilities': Zap,

  // Transportation
  'transport': Car,
  'car': Car,
  'vehicle': Car,
  'uber': Car,
  'taxi': Car,
  'parking': Car,
  'gas': Car,
  'fuel': Car,

  // General Actions
  'action': ArrowRight,
  'review': Eye,
  'check': CheckCircle,
  'approve': CheckCircle,
  'pending': Clock,
  'draft': FileText,
  'archive': Archive,
  'delete': Trash2,
  'important': Star,
  'urgent': AlertTriangle,
  'priority': Flag,

  // Default categories
  'other': Folder,
  'misc': Settings,
  'support': HelpCircle,
  'help': HelpCircle,
  'feedback': MessageSquare,
  'contact': Phone,
  'info': Info,
  'general': Folder,
};

/**
 * Generate an appropriate icon component based on folder name
 */
export function generateIconForFolder(folderName: string): any {
  const normalizedName = folderName.toLowerCase().trim();
  
  // Check for exact matches first
  if (iconKeywordMap[normalizedName]) {
    return iconKeywordMap[normalizedName];
  }
  
  // Check for partial matches
  for (const [keyword, IconComponent] of Object.entries(iconKeywordMap)) {
    if (normalizedName.includes(keyword)) {
      return IconComponent;
    }
  }
  
  // Special pattern matching
  if (normalizedName.match(/email|mail|inbox/)) return Mail;
  if (normalizedName.match(/\b(vip|important|priority)\b/)) return Star;
  if (normalizedName.match(/\b(spam|junk|trash)\b/)) return Trash2;
  if (normalizedName.match(/\b(sent|outbox)\b/)) return ArrowRight;
  if (normalizedName.match(/\b(draft|unsent)\b/)) return FileText;
  if (normalizedName.match(/\b(archive|old)\b/)) return Archive;
  if (normalizedName.match(/\b(todo|task|action)\b/)) return CheckCircle;
  if (normalizedName.match(/\b(read|review)\b/)) return Eye;
  if (normalizedName.match(/\b(unread|new)\b/)) return Bell;
  
  // Default fallback icon
  return Folder;
}

/**
 * Get icon color class based on folder name context
 */
export function generateColorForFolder(folderName: string): { textColor: string; bgColor: string; } {
  const normalizedName = folderName.toLowerCase().trim();
  
  // Financial/Money related - Yellow
  if (normalizedName.match(/financial|money|bank|payment|billing|invoice|tax|crypto|invest/)) {
    return { textColor: 'text-yellow-400', bgColor: 'bg-yellow-900/20 border-yellow-800' };
  }
  
  // Work/Business - Purple
  if (normalizedName.match(/work|business|office|job|project|meeting|report/)) {
    return { textColor: 'text-purple-400', bgColor: 'bg-purple-900/20 border-purple-800' };
  }
  
  // Travel - Cyan
  if (normalizedName.match(/travel|flight|hotel|trip|vacation|airline/)) {
    return { textColor: 'text-cyan-400', bgColor: 'bg-cyan-900/20 border-cyan-800' };
  }
  
  // Social/Personal - Green
  if (normalizedName.match(/social|personal|friend|family|community|chat/)) {
    return { textColor: 'text-green-400', bgColor: 'bg-green-900/20 border-green-800' };
  }
  
  // Newsletter/Marketing - Blue
  if (normalizedName.match(/newsletter|news|marketing|promo|deal|digest/)) {
    return { textColor: 'text-blue-400', bgColor: 'bg-blue-900/20 border-blue-800' };
  }
  
  // Important/Urgent - Red
  if (normalizedName.match(/urgent|important|priority|action|alert/)) {
    return { textColor: 'text-red-400', bgColor: 'bg-red-900/20 border-red-800' };
  }
  
  // Notifications - Orange
  if (normalizedName.match(/notification|alert|reminder|update/)) {
    return { textColor: 'text-orange-400', bgColor: 'bg-orange-900/20 border-orange-800' };
  }
  
  // Health/Medical - Pink
  if (normalizedName.match(/health|medical|doctor|fitness|workout/)) {
    return { textColor: 'text-pink-400', bgColor: 'bg-pink-900/20 border-pink-800' };
  }
  
  // Tech/Development - Indigo
  if (normalizedName.match(/tech|software|dev|code|api|system|github/)) {
    return { textColor: 'text-indigo-400', bgColor: 'bg-indigo-900/20 border-indigo-800' };
  }
  
  // Default - Gray
  return { textColor: 'text-gray-400', bgColor: 'bg-gray-900/20 border-gray-800' };
}