import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe } from 'lucide-react';

interface CountrySelectorProps {
  value: string;
  onChange: (country: string) => void;
}

const CountrySelector = ({ value, onChange }: CountrySelectorProps) => {
  const { data: countries } = useQuery({
    queryKey: ['country-configs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('country_configs')
        .select('country_code, label')
        .eq('enabled', true)
        .order('label');
      if (error) throw error;
      return data || [];
    },
  });

  if (!countries || countries.length <= 1) return null;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[140px] h-9">
        <Globe className="h-4 w-4 mr-1.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {countries.map(c => (
          <SelectItem key={c.country_code} value={c.country_code}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default CountrySelector;
